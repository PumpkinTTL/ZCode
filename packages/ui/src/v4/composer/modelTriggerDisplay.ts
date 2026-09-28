import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";

interface V4ModelTriggerDisplay {
  fullLabel: string;
  modelLabel: string;
}

/**
 * 模型切换记录的展示文案。官方套餐身份已随官方账号业务移除；
 * 历史会话里可能仍有套餐切换记录，这里退回普通 Provider/模型文案。
 */
export function formatModelChangeLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
  _intl: Pick<IntlInstance, "formatMessage">,
): string {
  void _intl;
  return formatProviderModelLabel(providerId, providerName, modelName);
}

export function formatProviderModelLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
): string {
  void providerId;
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
