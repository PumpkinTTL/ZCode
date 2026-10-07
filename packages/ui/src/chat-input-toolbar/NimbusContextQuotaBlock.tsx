/**
 * 上下文容量弹窗底部的「剩余额度」块（Polaris 自有业务，对齐官方原版：选中官方模型才显示额度）。
 *
 * 判定链：调用方（composer 工具栏）已把**当前模型所属供应商**解析好传进来（来自 modelSelectionView
 * 的有效配置，零额外 IPC）；本块只负责补第三方判据（额度服务 base 的同源比较，异步一次）并渲染。
 * 未登录或非 Nimbus：渲染 null，零视觉变化（弹窗其余部分不受影响）。
 */
import { useCallback, useEffect, useState } from "react";
import { NimbusQuotaSummaryAuto } from "@/business/quota/NimbusQuotaSummary.js";
import { useNimbusAccountState } from "@/business/quota/nimbusAccountState.js";
import { isNimbusProvider, type NimbusProviderLike } from "@/business/quota/nimbusProviderMatch.js";
import { useServices } from "@/hooks/useServices.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";

export function NimbusContextQuotaBlock({ provider }: { provider: NimbusProviderLike | null }) {
  const { providerQuotaService } = useServices();
  const account = useNimbusAccountState();
  const openSettingsTab = useOptionalTabStore((state) => state.openSettingsTab);
  // 第三级判据（手工建的同源供应商）需要额度服务 base；拿不到就退化到模板/展示名两级。
  const [quotaBaseUrl, setQuotaBaseUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void providerQuotaService
      .getBaseUrl()
      .then((url) => {
        if (!cancelled) {
          setQuotaBaseUrl(url);
        }
      })
      .catch(() => {
        // base 读不到只影响"同源"判定，不阻断卡片。
      });
    return () => {
      cancelled = true;
    };
  }, [providerQuotaService]);

  // 与供应商详情卡同款跳转：先写一次性意图（设置页已打开时由事件即时切换分区），再激活设置 tab。
  const handleManage = useCallback(() => {
    setPendingSettingsSection("providerQuota");
    openSettingsTab();
  }, [openSettingsTab]);

  if (!isNimbusProvider(provider, quotaBaseUrl)) {
    return null;
  }

  // 未登录/登录态未知时整体不渲染：内部摘要返回 null 只清内容，外层 border-t + pt-3
  // 仍会留下一条空分隔线（登出后表现为残留空块）；与文件头「未登录渲染 null」一致。
  if (!account.loggedIn) {
    return null;
  }

  return (
    <div className="border-t border-border pt-3" data-nimbus-context-quota="">
      <NimbusQuotaSummaryAuto compact onManage={handleManage} />
    </div>
  );
}
