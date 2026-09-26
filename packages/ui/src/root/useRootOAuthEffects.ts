import { useEffect } from "react";
import type { IPlatformService, OAuthProviderId, UserInfo } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { logger } from "@/logger.js";

/**
 * Root 层 OAuth 生命周期副作用（Polaris 最小实现）。
 *
 * 官方账号体系已移除：`oauthService` 为空壳（无 provider、`restoreCachedSessionState`
 * 恒返回 `signed-out`、`startOAuth` 抛可读错误），因此下面的登录轮询、deep-link 回调、
 * JWT 失效广播、登录后 provider family 校正等链路全部不可达，已一并删除。
 *
 * 目前只保留两件事：启动恢复登录态（恒未登录）与通知主进程渲染就绪。
 * 接自有账号体系时在这里补回登录/轮询/回调处理即可；对外 props 签名保持不变。
 */
export function useRootOAuthEffects({
  platform,
  services,
  refreshProviderState,
  setUser,
  setIsRestoringOAuthSession,
}: {
  accountIntentKey: string;
  platform: IPlatformService;
  services: IServiceAccessor;
  refreshProviderState: () => Promise<void>;
  refreshAppSettings?: () => Promise<void>;
  setUser: (user: UserInfo | null) => void;
  setIsRestoringOAuthSession: (restoring: boolean) => void;
  setOAuthError: (error: string | null) => void;
  oauthPollingActive: boolean;
  setOAuthPollingActive: (active: boolean) => void;
  markOAuthSuccess: (provider?: OAuthProviderId) => void;
  onReauthenticationRequired: () => void;
}) {
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const result = await services.oauthService.restoreCachedSessionState();
        if (disposed) return;
        setUser(result.status === "authenticated" ? result.userInfo : null);
      } catch (error) {
        logger.warn("[Root] 启动恢复登录态失败", { error });
        if (disposed) return;
        setUser(null);
      } finally {
        // 启动恢复是后台流程：结束即时落定状态，让 footer 从 loading 收敛到最终登录态。
        if (!disposed) setIsRestoringOAuthSession(false);
      }

      // Provider Runtime 刷新保持后台执行，避免首屏等待网络链路。
      try {
        await refreshProviderState();
      } catch (error) {
        // 启动刷新失败不能跳过后续订阅；保留当前事实，由后续更新驱动。
        logger.warn("[Root] 启动账号配置刷新失败，继续观察后续更新", { error });
      }
    })();

    return () => {
      disposed = true;
    };
  }, [refreshProviderState, services, setIsRestoringOAuthSession, setUser]);

  useEffect(() => {
    platform.notifyRendererReady();
  }, [platform]);
}
