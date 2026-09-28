import { useEffect, useMemo } from "react";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import type { ProviderOrderView } from "@/lib/modelProviderOrdering.js";
import { sortModelProvidersForDisplay } from "@/lib/modelProviderOrdering.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { type ModelProviderNavGroup } from "@/settings/model-provider-section/constants.js";
import { createCustomProviderNodeKey } from "@/settings/model-provider-section/utils.js";

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  modelProvidersLoading?: boolean;
  displayOrder?: ProviderOrderView;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}

/**
 * Model Provider 左侧导航。官方账号套餐（Coding Plan / Start Plan / Team 与 OAuth
 * 预置入口）已随官方账号业务整体移除，只剩「自定义供应商」分组；
 * 这里负责分组、选中项回退与 `navigationUnavailable`（恒为 false，仅保留契约位）。
 */
export function useModelProviderNavigation({
  modelProviders,
  displayOrder,
  selectedNodeKey,
  setSelectedNodeKey,
  intl,
}: UseModelProviderNavigationOptions) {
  const customProviders = useMemo(() => {
    const allCustomProviders = modelProviders.filter(
      (provider) => provider.config.group === "standard-personal",
    );
    // 这里复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
    return sortModelProvidersForDisplay(allCustomProviders, displayOrder);
  }, [displayOrder, modelProviders]);

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(() => {
    return [
      {
        id: "custom",
        title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
        items: customProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          type: "custom" as const,
          label: getProviderFormLabel(provider),
          provider,
          statusActive: provider.executable === true,
        })),
      },
    ];
    // 左侧导航分组标题在这个 memo 内格式化。
    // 语言切换时 provider 引用可能不变，必须依赖 intl 才能刷新旧 locale 的文案。
  }, [customProviders, intl]);

  const navigationItems = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );

  const navigationItemByKey = useMemo(
    () => new Map(navigationItems.map((item) => [item.key, item])),
    [navigationItems],
  );

  const selectedNavItem = selectedNodeKey
    ? (navigationItemByKey.get(selectedNodeKey) ?? null)
    : null;

  const fallbackNodeKey = navigationItems[0]?.key ?? null;
  useEffect(() => {
    const hasSelectedNode = selectedNodeKey ? navigationItemByKey.has(selectedNodeKey) : false;
    if (hasSelectedNode) {
      return;
    }
    if (selectedNodeKey !== fallbackNodeKey) {
      setSelectedNodeKey(fallbackNodeKey);
    }
  }, [fallbackNodeKey, navigationItemByKey, selectedNodeKey, setSelectedNodeKey]);

  return {
    navigationGroups,
    navigationItems,
    selectedNavItem,
    navigationUnavailable: false,
  };
}
