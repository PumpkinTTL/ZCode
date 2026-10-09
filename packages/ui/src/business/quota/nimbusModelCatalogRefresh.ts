/**
 * 官方模型展示元数据（倍率/标签/限时折扣）的拉取编排：挂载时按需刷新。
 *
 * 为什么不在 provision 之外再判断登录：数据端点两条路都行——
 * 登录态走 /v1/models（ensureApiKey 拿 sk-），未登录/断链回退免登录
 * /app-updates/models（同一构建器的匿名视角）。展示字段是装饰性数据，
 * 失败整体静默（保留上一次快照或空），绝不打扰用户、绝不抛穿。
 */
import { useEffect } from "react";
import type { IProviderQuotaService, IProviderSettingsService, QuotaModelCatalogEntry } from "@zcode/services";
import { publishNimbusModelDisplayMeta } from "@/lib/nimbusModelDisplayMeta.js";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { findNimbusProvider } from "./provisionNimbusProvider.js";

/** 刷新间隔：展示字段是装饰性数据，低频即可；重开应用/重新挂载时按此节流。 */
const REFRESH_STALE_MS = 5 * 60 * 1000;

let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

export interface NimbusModelCatalogRefreshDeps {
  readonly quota: Pick<IProviderQuotaService, "getBaseUrl" | "ensureApiKey" | "getModelCatalog">;
  readonly providerSettings: Pick<IProviderSettingsService, "getView">;
  /** 免登录目录兜底（未登录/密钥断链时仍能标出公开组合的展示字段）。 */
  readonly publicCatalog?: () => Promise<readonly QuotaModelCatalogEntry[]>;
  readonly logger?: { warn: (...args: unknown[]) => void };
}

/**
 * 拉取并发布展示元数据；节流 + 在途去重（未登录时也不会反复打后端）。
 * 找不到官方供应商时直接返回（等开通流程自己发布，避免先建一个空魂商）。
 */
export function refreshNimbusModelCatalogIfStale(
  deps: NimbusModelCatalogRefreshDeps,
): Promise<void> {
  const now = Date.now();
  if (inFlight) return inFlight;
  if (now - lastAttemptAt < REFRESH_STALE_MS) return Promise.resolve();
  lastAttemptAt = now;
  inFlight = (async () => {
    try {
      const baseUrl = await deps.quota.getBaseUrl();
      const view = await deps.providerSettings.getView();
      const provider = findNimbusProvider(view.providers, baseUrl);
      if (!provider) return;
      try {
        const apiKey = await deps.quota.ensureApiKey();
        publishNimbusModelDisplayMeta(provider.providerId, await deps.quota.getModelCatalog(apiKey));
        return;
      } catch {
        // 未登录 / 密钥断链：回退公开目录（匿名视角，带公开组合的展示字段）。
      }
      if (deps.publicCatalog) {
        const entries = await deps.publicCatalog();
        publishNimbusModelDisplayMeta(provider.providerId, entries);
      }
    } catch (error) {
      // 展示元数据失败不打扰用户（下次挂载再试）；也不清空既有快照。
      deps.logger?.warn("[nimbus] 模型展示元数据刷新失败", error);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * 组件挂载钩子：接入模型选择器/设置页等会渲染官方模型的位置，触发节流刷新。
 * 依赖服务实例（useServices）；模块级节流保证多面挂载不会重复打后端。
 */
export function useNimbusModelCatalogRefresh(): void {
  const { providerQuotaService, providerSettingsService, appUpdateService } = useServices();
  useEffect(() => {
    void refreshNimbusModelCatalogIfStale({
      quota: providerQuotaService,
      providerSettings: providerSettingsService,
      publicCatalog: appUpdateService ? () => appUpdateService.listPublicModelCatalog() : undefined,
      logger,
    });
  }, [providerQuotaService, providerSettingsService, appUpdateService]);
}
