/**
 * 登录后的供应商自动开通：拿 sk- 密钥 → 拉模型目录 → 建/更新 Nimbus 供应商 → 置顶。
 *
 * 这是「登录 → 可用」的编排层：额度服务只负责 Nimbus API，
 * 供应商注册走 providerSettingsService（与手动添加供应商同一条通路）。
 * 因此登录后模型菜单全局立即可见（供应商列表本身就是全局状态）。
 */
import type { IProviderSettingsService } from "@zcode/services";

export const NIMBUS_TEMPLATE_ID = "nimbus";

/** sk- 密钥 + 模型目录都就绪后的开通结果。 */
export interface NimbusProvisionResult {
  readonly providerId: string;
  readonly modelCount: number;
  /** 已有供应商复用（true）；本次新建（false） */
  readonly reused: boolean;
}

/**
 * 登录后调用：确保 Nimbus 供应商存在且带可用密钥，并置顶。
 *
 * 密钥策略（回答“拿登录的 key 还是手动配置 key”）：
 * - 聊天调用用的是中转站的 sk- 密钥，不是登录 token；
 * - 登录 token 用于额度查询与密钥自管理：这里自动复用/创建一个 sk- 密钥写进供应商；
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
  const modelIds = await deps.quota
    .getModelIds(apiKey)
    .catch((error: unknown) => {
      deps.logger?.warn("[nimbus] 拉取模型目录失败，先建供应商，模型可手动添加", error);
      return [] as string[];
    });

  const view = await deps.providerSettings.getView();
  const existing = view.providers.find(
    (provider) => provider.templateId === NIMBUS_TEMPLATE_ID,
  );

  if (existing) {
    // 复用：只把最新的 sk- 密钥写进供应商覆盖层（用户手动换过的 key 会被刷新为登录账号的可用密钥）。
    await deps.providerSettings.savePersonalProviderOverlay(existing.providerId, {
      access: { type: "api-key", apiKey },
    });
    await pinFirst(deps.providerSettings, view.providerOrder, existing.providerId);
    return { providerId: existing.providerId, modelCount: modelIds.length, reused: true };
  }

  const created = await deps.providerSettings.createPersonalProvider({
    templateId: NIMBUS_TEMPLATE_ID,
    initialConfig: {
      access: { type: "api-key", apiKey },
      ...(modelIds.length > 0 ? { personalModelIds: [...modelIds] } : {}),
    },
  });
  await pinFirst(deps.providerSettings, view.providerOrder, created.providerId);
  return { providerId: created.providerId, modelCount: modelIds.length, reused: false };
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
