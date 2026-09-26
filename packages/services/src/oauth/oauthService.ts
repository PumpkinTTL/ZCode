import type {
  OAuthCachedSessionRestoreResult,
  OAuthCallbackResult,
  OAuthProviderId,
  OAuthProviderMeta,
  OAuthStartResponse,
  UserInfo,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IOAuthService } from "./oauth.js";

/**
 * OAuth 服务的装配依赖。
 *
 * Polaris fork：官方账号（Z.ai / BigModel）的 provider 适配器、授权码交换、polling、
 * token 刷新与 JWT 失效失效链路已整体移除。这里保留装配签名，接自有 OAuth provider 时
 * 只需在 `OAuthService` 内实现 `IOAuthService`（依赖对象原样保留），调用点无需改动。
 */
export interface OAuthServiceDependencies {
  /** 预留：接自有 OAuth provider 时用于请求授权/换 token。 */
  apiClient?: unknown;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** provider 登出回调：用于清理派生的 Start / Coding Plan provider key。 */
  onProviderLogout?: (
    provider: OAuthProviderId,
    accountIdentity?: string | null,
  ) => Promise<void>;
}

const OAUTH_REMOVED_MESSAGE = "Polaris 未接入自有账号体系，OAuth 登录当前不可用。";

const serviceLog = createServiceLogger("oauthService");

/**
 * OAuth 认证服务（空实现）。
 *
 * 官方 provider 清空后，服务对外恒定表达「无提供方、未登录、无待处理 OAuth」：
 * 不发起任何远端请求、不读写官方凭据、不抛错（显式登录入口除外）。
 * 界面因此稳定收敛到未登录态；接自有账号体系时在这里实现接口即可。
 */
export class OAuthService implements IOAuthService {
  constructor(_credentialService: ICredentialService, dependencies: OAuthServiceDependencies = {}) {
    // 空实现不消费依赖；参数保留以维持既有装配点（node.ts / desktop remote Host）兼容。
    void _credentialService;
    void dependencies;
  }

  async getProviders(): Promise<OAuthProviderMeta[]> {
    return [];
  }

  async getActiveProvider(): Promise<OAuthProviderId | null> {
    return null;
  }

  async restoreCachedSession(): Promise<UserInfo | null> {
    return null;
  }

  async restoreCachedSessionState(): Promise<OAuthCachedSessionRestoreResult> {
    // 没有官方 provider 即没有可恢复的官方登录态；直接返回「从未登录」。
    return { status: "signed-out" };
  }

  async restoreSession(): Promise<UserInfo | null> {
    return null;
  }

  async startOAuth(_provider: OAuthProviderId): Promise<OAuthStartResponse> {
    serviceLog.info("startOAuth rejected: official OAuth providers removed");
    throw new Error(OAUTH_REMOVED_MESSAGE);
  }

  async startOAuthWithPolling(_provider: OAuthProviderId): Promise<OAuthStartResponse> {
    serviceLog.info("startOAuthWithPolling rejected: official OAuth providers removed");
    throw new Error(OAUTH_REMOVED_MESSAGE);
  }

  async pollPendingOAuth(): Promise<OAuthCallbackResult | null> {
    return null;
  }

  async handleCallback(_url: string): Promise<OAuthCallbackResult | null> {
    return null;
  }

  async refreshToken(_provider?: OAuthProviderId): Promise<void> {
    // 无官方 token 可刷新。
  }

  async logout(_provider?: OAuthProviderId): Promise<void> {
    // 无官方登录态可清理。
  }

  async logoutAll(): Promise<void> {
    // 无官方登录态可清理。
  }

  async cancelPending(_provider?: OAuthProviderId): Promise<void> {
    // 无 pending OAuth flow。
  }

  /**
   * Host 本地 401 提交入口，不扩展 `IOAuthService` 的跨端契约。
   *
   * 官方 JWT 链路已移除，这里恒返回 false：既不清理会话，也不触发 JWT 失效广播。
   */
  logoutIfCurrentCredentialRequest(_input: string | URL, _headers: Headers): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** 工厂函数：创建 OAuthService 实例。 */
export function createOAuthService(
  credentialService: ICredentialService,
  dependencies: OAuthServiceDependencies = {},
): OAuthService {
  return new OAuthService(credentialService, dependencies);
}
