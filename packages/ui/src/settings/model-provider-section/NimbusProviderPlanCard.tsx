/**
 * 模型设置「供应商详情」顶部的套餐/剩余额度卡（Polaris 自有业务，补回上游被移除的官方套餐卡位）。
 *
 * 挂在详情编辑表单上方，只对 Nimbus 供应商渲染：
 *  - 判定走共享匹配器 isNimbusProvider（templateId → 展示名 → API 同源三级口径），
 *    额度服务实际生效的 base URL 异步取一次（dev=本地/打包=域名），取不到就退化到前两级；
 *  - 登录态走共享快照 useNimbusAccountState（与侧边栏底部、「我的额度」同一数据源）：
 *    已登录渲染 NimbusQuotaSummaryAuto；明确未登录渲染轻量占位行；登录态未知时先不渲染，
 *    避免把「还没问到」误报成「未连接」；
 *  - 「管理」动作与官方原版一致：跳设置页「我的额度」节（登录表单在那一节里，不在卡内自建登录）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isNimbusProvider } from "@/business/quota/nimbusProviderMatch.js";
import { useNimbusAccountState } from "@/business/quota/nimbusAccountState.js";
import { NimbusQuotaSummaryAuto } from "@/business/quota/NimbusQuotaSummary.js";
import { provisionNimbusProvider } from "@/business/quota/provisionNimbusProvider.js";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";

export function NimbusProviderPlanCard({ provider }: { provider: ProviderSettingsFormProvider }) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService } = useServices();
  const account = useNimbusAccountState();
  // 展示组件可能在无 Tab provider 的独立渲染中出现（同 V4 工具条入口），用可选版本兜底。
  const openSettingsTab = useOptionalTabStore((state) => state.openSettingsTab);
  // 判定「手工建的同源供应商」需要额度服务 base；拿不到就保持 undefined，退化到模板/名称两级。
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
        // base 读不到只影响“同源”这一级判定，模板/展示名两级仍能认领，不阻断卡片。
      });
    return () => {
      cancelled = true;
    };
  }, [providerQuotaService]);

  // 照抄既有「设置节跳转」用法（V4ComposerToolbar 的“管理模型”）：
  // 先写一次性意图（设置页已打开时由事件即时切换分区），再确保设置 tab 处于激活状态。
  const handleManage = useCallback(() => {
    setPendingSettingsSection("providerQuota");
    openSettingsTab();
  }, [openSettingsTab]);

  // 打开官方详情页即补同步（幂等开通：key/基址/模型目录以远端为准）。
  // 登录态未知时不跑；每轮登录至多一次，失败静默（模型列表保持现状，下次再试）。
  const provisionAttemptedRef = useRef(false);
  useEffect(() => {
    if (!account.loggedIn) {
      // 登出会清掉覆盖层凭证；同一挂载内再登录（卡片一直开着）必须重新开通，
      // 否则详情卡显示已连接、模型却在菜单里因无凭证不可用。
      provisionAttemptedRef.current = false;
      return;
    }
    if (provisionAttemptedRef.current) return;
    provisionAttemptedRef.current = true;
    void provisionNimbusProvider({
      quota: providerQuotaService,
      providerSettings: providerSettingsService,
    }).catch((error: unknown) => {
      logger.warn("[NimbusProviderPlanCard] 详情页补同步失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [account.loggedIn, providerQuotaService, providerSettingsService]);

  const isNimbus = isNimbusProvider(
    {
      providerName: provider.providerName,
      templateId: provider.templateId,
      // 表单 provider 的 config 即 Effective Config（继承基线与即时展示值），
      // 手工建的 NimbusLocal 在这里带出 api.baseUrl。
      api: provider.config.api,
    },
    quotaBaseUrl,
  );
  if (!isNimbus) {
    return null;
  }

  // 登录态未知（首屏快照未回/查询失败）时不渲染：占位行文案是「未连接」，
  // 状态未知时渲染等于误报；也不留一张空壳卡。
  if (account.status === null) {
    return null;
  }

  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-4" data-nimbus-plan-card="">
      {account.loggedIn ? (
        <NimbusQuotaSummaryAuto onManage={handleManage} />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.summaryLoggedOut" })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={handleManage}
          >
            {intl.formatMessage({ id: "business.quota.manage" })}
          </Button>
        </div>
      )}
    </div>
  );
}
