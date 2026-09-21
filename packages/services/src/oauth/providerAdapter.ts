import type {
  ApiClient,
  OAuthCallbackParams,
  OAuthProviderId,
  OAuthProviderMeta,
  OAuthTokenSet,
  OAuthUserProfile,
} from "@zcode/shared";

/**
 * OAuth provider 适配器契约（纯类型，不含任何官方 provider 实现）。
 *
 * Polaris 已剥离 Z.ai / BigModel 的 adapter 实现，但 accessor.ts、node.ts、
 * feedbackService 仍引用 IOAuthService，且 profile schema / 401 归因等通用流程
 * 依赖本契约，因此类型必须保留：接入自有 OAuth provider 时实现本接口即可。
 */

/** Provider 执行上下文 */
export interface OAuthProviderContext {
  providerId: OAuthProviderId;
  state: string;
  redirectUri: string;
  now: () => number;
}

/** OAuth provider 适配器：隔离协议差异 */
export interface OAuthProviderAdapter {
  readonly providerId: OAuthProviderId;
  readonly meta: OAuthProviderMeta;
  readonly redirectUri: string;
  readonly apiClient: ApiClient;

  parseCallbackParams(url: string): OAuthCallbackParams;
  buildAuthorizeUrl(context: OAuthProviderContext): string;
  exchangeToken(params: OAuthCallbackParams, context: OAuthProviderContext): Promise<OAuthTokenSet>;
  /** 将后端 polling 返回的 provider token 归一化为 Desktop 持久化语义。 */
  normalizePolledTokenSet?(tokenSet: OAuthTokenSet): Promise<OAuthTokenSet>;
  fetchUserInfo?(tokenSet: OAuthTokenSet, context: OAuthProviderContext): Promise<OAuthUserProfile>;
  refreshToken?(tokenSet: OAuthTokenSet, context: OAuthProviderContext): Promise<OAuthTokenSet>;

  /** provider 级 legacy 凭据读取（用于升级兼容） */
  loadLegacyTokenSet?(
    loadCredential: (key: string) => Promise<string | null>,
  ): Promise<OAuthTokenSet | null>;

  normalizeError(error: unknown): Error;
}
