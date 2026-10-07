/**
 * 登录后的供应商自动开通：取账号可用调用密钥 → 拉模型目录 → 建/更新 Nimbus 供应商 → 置顶。
 *
 * 这是「登录 → 可用」的编排层：额度服务只负责 Nimbus API，
 * 供应商注册走 providerSettingsService（与手动添加供应商同一条通路）。
 * 因此登录后模型菜单全局立即可见（供应商列表本身就是全局状态）。
 *
 * 为什么不直接依赖内置模板：Built-in Provider Config 有独立的 revision / 缓存 /
 * 远端同步三层，配置层缺模板时登录会被一句「Provider Template 不存在」打断。
 * 所以模板只在存在时用作首选配方，缺失时用下面这份等价配方自行建供应商。
 */
import type {
  IProviderSettingsService,
  ModelSelectionView,
  ProviderSettingsProviderView,
} from "@zcode/services";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import {
  NIMBUS_PROVIDER_LABEL,
  NIMBUS_TEMPLATE_ID,
  providerBaseOrigin,
} from "./nimbusProviderMatch.js";

// 判定常数与展示名的权威定义搬到了 nimbusProviderMatch（匹配器与登录开通共用一份）：
// 依赖方向单向（本模块 → 匹配器），避免循环引用；这里只做转出保持既有 import 方不变。
export { NIMBUS_PROVIDER_LABEL, NIMBUS_TEMPLATE_ID };

/** sk- 密钥 + 模型目录都就绪后的开通结果。 */
export interface NimbusProvisionResult {
  readonly providerId: string;
  readonly modelCount: number;
  /** 已有供应商复用（true）；本次新建（false） */
  readonly reused: boolean;
}

/**
 * 中转站的 OpenAI 兼容入口：地址与额度服务同源，由服务实例给出（`getBaseUrl`）。
 * 不再读编译期常量：dev（未打包）指向本地 127.0.0.1:8000、打包指向域名、QUOTA_BASE_URL
 * 可覆盖 —— 供应商必须跟额度服务走同一个 base，否则会出现「额度在本地、聊天打线上」的分裂。
 */
function resolveNimbusAccessRecipe(baseUrl: string): {
  readonly access: { readonly type: "api-key"; readonly apiKeyManagementUrl: string };
  readonly api: { readonly type: "openai-chat-completions"; readonly baseUrl: string };
} {
  const origin = baseUrl.trim().replace(/\/+$/u, "");
  return {
    access: { type: "api-key", apiKeyManagementUrl: origin },
    api: { type: "openai-chat-completions", baseUrl: `${origin}/v1` },
  };
}

/** 认 Nimbus 供应商：模板按 templateId 认；模板缺失按展示名认；手工建的本地联调供应商按
 * 「API 基址与额度服务同源」认领 —— 否则登录会自动再建一个 "Nimbus"，把用户已有的可用
 * 配置架空成重复项（实测：手工建的 "NimbusLocal" 指向同一中继时命中本条）。 */
function findNimbusProvider(
  providers: readonly ProviderSettingsProviderView[],
  baseUrl: string,
): ProviderSettingsProviderView | undefined {
  const origin = providerBaseOrigin(baseUrl);
  return (
    providers.find((provider) => provider.templateId === NIMBUS_TEMPLATE_ID) ??
    providers.find((provider) => provider.providerName === NIMBUS_PROVIDER_LABEL) ??
    (origin === null
      ? undefined
      : providers.find((provider) => providerBaseOrigin(providerApiBaseUrl(provider)) === origin))
  );
}

/** 取供应商视图里生效配置的 OpenAI 兼容基址（字段名跟随 ProviderConfigObject，容错读法）。 */
function providerApiBaseUrl(provider: ProviderSettingsProviderView): string | null {
  const config = provider.effectiveConfig as { api?: { baseUrl?: unknown } } | undefined;
  const baseUrl = config?.api?.baseUrl;
  return typeof baseUrl === "string" ? baseUrl : null;
}

/**
 * 登录后调用：确保 Nimbus 供应商存在且带可用密钥，并置顶。
 *
 * 密钥策略（回答“拿登录的 key 还是手动配置 key”）：
 * - 聊天调用用的是中转站的调用密钥，不是登录 token；
 * - 登录 token 用于额度查询与密钥读取；账号里一把可用密钥都没有时，
 *   `ensureApiKey` 会自动创建一把（登录即可用，对齐 Lyra 自动认领），见 quotaService；
 * - 用户之后仍可在供应商编辑里手动换 key（覆盖自动值）。
 */
export async function provisionNimbusProvider(deps: {
  readonly quota: {
    ensureApiKey(): Promise<string>;
    getBaseUrl(): Promise<string>;
    getModelIds(apiKey: string): Promise<readonly string[]>;
  };
  readonly providerSettings: IProviderSettingsService;
  readonly logger?: { warn: (...args: unknown[]) => void };
}): Promise<NimbusProvisionResult> {
  // base 与额度服务同源（dev=本地/打包=域名/环境变量可覆盖），模型调用与密钥管理都指向它。
  const baseUrl = await deps.quota.getBaseUrl();
  const apiKey = await deps.quota.ensureApiKey();
  const modelIds = await deps.quota.getModelIds(apiKey).catch((error: unknown) => {
    deps.logger?.warn("[nimbus] 拉取模型目录失败，先建供应商，模型可手动添加", error);
    return [] as string[];
  });

  const view = await deps.providerSettings.getView();
  const existing = findNimbusProvider(view.providers, baseUrl);

  if (existing) {
    // 复用：把登录账号的最新 sk- 密钥写进覆盖层（用户手动换过的 key 会被刷新为登录账号的可用密钥）。
    // 同时覆盖 api 基址：内置条目默认生产地址，dev（未打包）联调在此改写为本地中继——
    // 供应商必须与额度服务同源，否则出现「额度在本地、聊天打线上」的分裂（生产两者相同，写一遍无害）。
    // 模型目录同样持久化进覆盖层（远端 /v1/models 是唯一事实源；拉到才写，失败不清空现有列表）。
    await deps.providerSettings.savePersonalProviderOverlay(existing.providerId, {
      access: { type: "api-key", apiKey },
      api: resolveNimbusAccessRecipe(baseUrl).api,
      ...(modelIds.length > 0 ? { personalModelIds: [...modelIds] } : {}),
    });
    await pinFirst(deps.providerSettings, view.providerOrder, existing.providerId);
    return { providerId: existing.providerId, modelCount: modelIds.length, reused: true };
  }

  const recipe = resolveNimbusAccessRecipe(baseUrl);
  const personalModelIds = modelIds.length > 0 ? { personalModelIds: [...modelIds] } : {};
  const templateAvailable = view.providerTemplates.some(
    (template) => template.templateId === NIMBUS_TEMPLATE_ID,
  );

  // 模板在：沿用模板配方（设置页展示品牌标与来源）。模板缺失：自带 access + api 配方。
  const created = await deps.providerSettings.createPersonalProvider(
    templateAvailable
      ? {
          templateId: NIMBUS_TEMPLATE_ID,
          initialConfig: { access: { type: "api-key", apiKey }, ...personalModelIds },
        }
      : {
          providerName: NIMBUS_PROVIDER_LABEL,
          initialConfig: {
            access: { ...recipe.access, apiKey },
            api: recipe.api,
            ...personalModelIds,
          },
        },
  );
  await pinFirst(deps.providerSettings, view.providerOrder, created.providerId);
  return { providerId: created.providerId, modelCount: modelIds.length, reused: false };
}

/**
 * 登出清理：登出「照样拉，只是不给用」——保留模型目录、只清凭证。
 *
 * 覆盖层里两类字段的生命周期不同：
 *  - sk- 密钥与 api 基址是凭证，登出必须清除（本地不持有任何可用调用凭证，
 *    设置页回落内置基线的「未连接」态），并且删除覆盖层是唯一可靠手段；
 *  - 模型目录是展示事实，登出后在选择菜单里保持可见（V4ComposerToolbar 按登录态
 *    置灰锁定、不可选），用户重新登录即可直接继续用，不必等一次远端同步。
 * 所以先取出模型名单，删掉整个覆盖层，再用「只有模型、无 access/api」的覆盖层写回。
 *
 * 只动覆盖层、不碰内置配置；无覆盖时直接返回（幂等，可安全用于启动自愈）。
 * 远端（中转站）的账户与密钥不做任何动作——那是服务端事实，登出不等于注销。
 */
export async function clearNimbusProviderAccess(deps: {
  readonly quota: { getBaseUrl(): Promise<string> };
  readonly providerSettings: Pick<
    IProviderSettingsService,
    "getView" | "deletePersonalProvider" | "savePersonalProviderOverlay"
  >;
  /**
   * 公开模型目录（免登录 /app-updates/models）：提供时用它刷新模型名单——
   * 本地残留的手工模型（服务器没有的）会被服务器目录自动替换掉。
   * 拉取失败回退到「保留登出前的名单」。
   */
  readonly publicModelCatalog?: () => Promise<readonly string[]>;
}): Promise<void> {
  const baseUrl = await deps.quota.getBaseUrl();
  const view = await deps.providerSettings.getView();
  const existing = findNimbusProvider(view.providers, baseUrl);
  if (!existing?.personalConfig) return;
  // 先记下模型目录：删覆盖层后它就没有来源了（模型是「下拉照样可见」的唯一依据）。
  const personalModelIds = existing.personalConfig.personalModelIds;
  // 整个覆盖层照删：凭证据此清零（含 access/api 两个字段），与旧登出语义一致。
  await deps.providerSettings.deletePersonalProvider(existing.providerId);
  // 模型名单：优先免登录公开目录（权威、自动清掉本地手工残留）；拉不到回退保留。
  let nextModelIds = personalModelIds ?? [];
  if (deps.publicModelCatalog) {
    try {
      const catalog = await deps.publicModelCatalog();
      if (catalog.length > 0) nextModelIds = [...catalog];
    } catch {
      // 公开目录失败不阻断登出，保留原名单即可。
    }
  }
  if (!nextModelIds.length) return;
  // 再写回一个只含模型的覆盖层：菜单里模型仍可见（锁定态），本地无任何可用凭证。
  await deps.providerSettings.savePersonalProviderOverlay(existing.providerId, {
    personalModelIds: [...nextModelIds],
  });
}

/**
 * 登录收尾用的默认模型偏好：取该供应商的第一个模型。
 * 供应商刚建好、用户还没选过模型，这是唯一无歧义的选择。
 */
export function resolveFirstModelPreference(
  view: ModelSelectionView,
  providerId: string,
): string | null {
  const firstModel = view.providers.find((provider) => provider.providerId === providerId)
    ?.models[0]?.modelId;
  return firstModel ? encodeCustomModelValue(providerId, firstModel) : null;
}

/** 把 Nimbus 排到个人供应商第一位（其余保持原有相对顺序）。 */
async function pinFirst(
  providerSettings: IProviderSettingsService,
  currentOrder: readonly string[] | undefined,
  providerId: string,
): Promise<void> {
  const rest = (currentOrder ?? []).filter((id) => id !== providerId);
  try {
    await providerSettings.reorderPersonalProviders([providerId, ...rest]);
  } catch (error) {
    // 置顶失败不影响供应商可用性；用户仍可在设置里手动拖动。
    void error;
  }
}
