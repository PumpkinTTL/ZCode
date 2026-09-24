import {
  BUILTIN_MODEL_PROVIDER_IDS,
  resolveModelProviderFamilyIdByProviderId,
} from "@zcode/shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";

interface V4ModelTriggerDisplay {
  fullLabel: string;
  modelLabel: string;
}

export function formatModelChangeLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
  intl: Pick<IntlInstance, "formatMessage">,
): string {
  let planLabelId: string;
  // 切换记录必须保留当时的套餐身份，不能从当前连接或可用模型目录反推历史套餐。
  switch (providerId) {
    case BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan:
      planLabelId = "settings.modelProvider.connectionMode.codingPlan";
      break;
    case BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan:
      planLabelId = "settings.modelProvider.connectionMode.startPlan";
      break;
    case BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan:
    case BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan:
      planLabelId = "settings.modelProvider.connectionMode.teamPlan";
      break;
    default:
      return formatProviderModelLabel(providerId, providerName, modelName);
  }
  return `${modelName}(${intl.formatMessage({ id: planLabelId })})`;
}

export function formatProviderModelLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
): string {
  // Z.ai / BigModel 的内置连接名属于产品固定入口，拼进模型文案会重复展示
  // “Coding Plan”等连接信息；切换提示额外通过 formatModelChangeLabel 标明套餐类型。
  if (providerId && resolveModelProviderFamilyIdByProviderId(providerId)) {
    return modelName;
  }

  const normalizedProviderName = providerName?.trim();
  return normalizedProviderName ? `${normalizedProviderName}/${modelName}` : modelName;
}

function findSelectedModelItem(
  modelGroups: readonly ModelSelectGroup[],
  normalizedValue: string,
): ModelSelectGroupItem | undefined {
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  return selectedGroup?.items.find((item) => item.value === normalizedValue);
}

/**
 * 触发器**可见**文案：只有模型名。
 *
 * Provider 层已经从模型菜单里移除，品牌身份改由模型前的图标承担；把
 * `Provider/模型` 再拼进触发器，等于把刚删掉的那一层又写回界面上。
 * 需要完整身份（含 Provider）的地方走 `formatProviderModelLabel` 或下面的 `fullLabel`。
 */
export function resolveV4ModelTriggerLabel({
  modelGroups,
  normalizedValue,
  fallbackLabel,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
}): string {
  return findSelectedModelItem(modelGroups, normalizedValue)?.name ?? fallbackLabel;
}

export function resolveV4ModelTriggerDisplay({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): V4ModelTriggerDisplay {
  const selectedItem = findSelectedModelItem(modelGroups, normalizedValue);
  if (!selectedItem) {
    return { fullLabel: fallbackLabel, modelLabel: fallbackLabel };
  }

  return {
    // 完整身份只给 tooltip 与 aria-label，不参与可见文案。
    fullLabel: formatProviderModelLabel(providerId, providerName, selectedItem.name),
    modelLabel: selectedItem.name,
  };
}
