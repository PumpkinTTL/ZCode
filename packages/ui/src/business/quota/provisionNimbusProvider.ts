/**
 * 登录后的供应商自动开通：取账号已有调用密钥 → 拉模型目录 → 建/更新 Nimbus 供应商 → 置顶。
 *
 * 这是「登录 → 可用」的编排层：额度服务只负责 Nimbus API，
 * 供应商注册走 providerSettingsService（与手动添加供应商同一条通路）。
 * 因此登录后模型菜单全局立即可见（供应商列表本身就是全局状态）。
 *
 * 为什么不直接依赖内置模板：Built-in Provider Config 有独立的 revision / 缓存 /
 * 远端同步三层，配置层缺模板时登录会被一句「Provider Template 不存在」打断。
 * 所以模板只在存在时用作首选配方，缺失时用下面这份等价配方自行建供应商。
 */
import {
  DEFAULT_QUOTA_BASE_URL,
  type IProviderSettingsService,
  type ModelSelectionView,
  type ProviderSettingsProviderView,
} from "@zcode/services";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

export const NIMBUS_TEMPLATE_ID = "nimbus";
/** 供应商展示名；同时作为模板缺失时的识别标记（那时没有 templateId 可用）。 */
export const NIMBUS_PROVIDER_LABEL = "Nimbus";

/** sk- 密钥 + 模型目录都就绪后的开通结果。 */
export interface NimbusProvisionResult {
  readonly providerId: string;
  readonly modelCount: number;
  /** 已有供应商复用（true）；本次新建（false） */
  readonly reused: boolean;
}

/**
 * 中转站的 OpenAI 兼容入口：地址与额度服务同源。
 * 换站只改 services 里的 DEFAULT_QUOTA_BASE_URL，这里跟随之。
 */
function resolveNimbusAccessRecipe(): {
  readonly access: { readonly type: "api-key"; readonly apiKeyManagementUrl: string };
  readonly api: { readonly type: "openai-chat-completions"; readonly baseUrl: string };
} {
  const origin = DEFAULT_QUOTA_BASE_URL.trim().replace(/\/+$/u, "");
  return {
    access: { type: "api-key", apiKeyManagementUrl: origin },
    api: { type: "openai-chat-completions", baseUrl: `${origin}/v1` },
  };
}

/** 认 Nimbus 供应商：模板在按 templateId 认，模板缺失时按展示名认。 */
function findNimbusProvider(
  providers: readonly ProviderSettingsProviderView[],
): ProviderSettingsProviderView | undefined {
  return (
    providers.find((provider) => provider.templateId === NIMBUS_TEMPLATE_ID) ??
    providers.find((provider) => provider.providerName === NIMBUS_PROVIDER_LABEL)
  );
}

/**
 * 登录后调用：确保 Nimbus 供应商存在且带可用密钥，并置顶。
 *
 * 密钥策略（回答“拿登录的 key 还是手动配置 key”）：
 * - 聊天调用用的是中转站的调用密钥，不是登录 token；
 * - 登录 token 只用于额度查询与**读取**密钥列表：这里复用账号里已有的第一把密钥，
 *   绝不代替用户在门户创建新密钥（见 IProviderQuotaService.ensureApiKey）；
 * - 账号里没有可用密钥时 ensureApiKey 会抛可读错误，由调用方决定是否阻断；
 * - 用户之后仍可在供应商编辑里手动换 key（覆盖自动值）。
 */
export async function provisionNimbusProvider(deps: {
  readonly quota: {
    ensureApiKey(): Promise<string>;
    getModelIds(apiKey: string): Promise<readonly string[]>;
  };
  readonly providerSettings: IProviderSettingsService;
  readonly logger?: { warn: (...args: unknown[]) => void };
}): Promise<NimbusProvisionResult> {
  const apiKey = await deps.quota.ensureApiKey();
  const modelIds = await deps.quota.getModelIds(apiKey).catch((error: unknown) => {
    deps.logger?.warn("[nimbus] 拉取模型目录失败，先建供应商，模型可手动添加", error);
    return [] as string[];
  });

  const view = await deps.providerSettings.getView();
  const existing = findNimbusProvider(view.providers);

  if (existing) {
    // 复用：只把最新的 sk- 密钥写进供应商覆盖层（用户手动换过的 key 会被刷新为登录账号的可用密钥）。
    await deps.providerSettings.savePersonalProviderOverlay(existing.providerId, {
      access: { type: "api-key", apiKey },
    });
    await pinFirst(deps.providerSettings, view.providerOrder, existing.providerId);
    return { providerId: existing.providerId, modelCount: modelIds.length, reused: true };
  }

  const recipe = resolveNimbusAccessRecipe();
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
