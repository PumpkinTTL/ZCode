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
  /** 官方（Nimbus）分组的徽章文案；缺省不给徽章。 */
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
    // 直出扁平列表 + 「官方」徽章（对齐原版官方模型不折叠的做法）。
    const isOfficial = provider.config.group === "nimbus";
    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label: provider.providerName?.trim() || provider.providerId,
        ...(isOfficial && labels.officialBadgeLabel
          ? { labelBadge: labels.officialBadgeLabel }
          : {}),
        ...(isOfficial ? { directItems: true } : {}),
        ...(isOfficial && labels.officialHeaderAction
          ? { headerAction: labels.officialHeaderAction }
          : {}),
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
