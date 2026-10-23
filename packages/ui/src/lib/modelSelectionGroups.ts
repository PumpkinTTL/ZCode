import { isZCodeAgentProvider, type ZCodeProvider } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import type {
  ModelSelectGroup,
  ModelSelectGroupHeaderAction,
} from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";

export interface ModelProviderGroupLabelOptions {
  apiKeyLabel?: string;
  apiKeyBadgeLabel?: string;
  /** 官方（Nimbus）分组的标题文案；传入后组标题直接用它（如「官方」），不再展示 providerName 品牌名。 */
  officialBadgeLabel?: string;
  /** 官方分组标题行的同步图标动作（标题行内嵌，不占 footer）。 */
  officialHeaderAction?: ModelSelectGroupHeaderAction;
}

function supportsRegistryApiFormat(
  selectedProvider: ZCodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（ZCode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isZCodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: ZCodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions = {},
): ModelSelectGroup[] {
  return view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    // 官方（Nimbus）模型目录来自远端 /v1/models 动态同步：菜单里不做二级折叠，
    // 直出扁平列表（对齐原版官方模型不折叠的做法）。分组标题用「官方」文案渲染成
    // 小巧的 tag 徽章（labelTag），不再展示 Nimbus 品牌名，也不占大字标题位。
    const isOfficial = provider.config.group === "nimbus";
    const officialLabel = labels.officialBadgeLabel?.trim();

    // 合并菜单仍需区分同名供应商的接入方式；接入标识只保留 API Key 一态，
    // 直接来自 access 配置，不从名称推断，也不暴露凭据。
    const labelBadge =
      provider.config.access?.type === "api-key" ? (labels.apiKeyBadgeLabel ?? "API") : undefined;

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label:
          isOfficial && officialLabel
            ? officialLabel
            : (provider.providerName?.trim() || provider.providerId),
        ...(isOfficial ? { directItems: true, labelTag: true } : {}),
        ...(isOfficial && labels.officialHeaderAction
          ? { headerAction: labels.officialHeaderAction }
          : {}),
        ...(provider.config.logo ? { logo: provider.config.logo } : {}),
        ...(labelBadge ? { labelBadge } : {}),
        items: provider.models.map(({ modelId, config }) => ({
          key: `registry-provider:${provider.providerId}:${modelId}`,
          value: encodeCustomModelValue(provider.providerId, modelId),
          // 展示名优先用用户设置的昵称；没设就回落模型 ID，真实请求始终只用 modelId。
          name: config.displayName?.trim() || modelId,
          iconModelId: modelId,
          iconProviderId: provider.providerId,
          ...(shouldShowModelVisionBadge(
            modelId,
            config.properties?.inputFormat?.supportsImage,
            provider.config.access,
          )
            ? { supportsVisionInput: true }
            : {}),
        })),
      },
    ];
  });
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  return decodeCustomModelValue(value)?.modelName ?? null;
}
