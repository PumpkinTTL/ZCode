import type { OAuthProviderId } from "@zcode/shared";

/**
 * OAuth provider 登出后的派生清理（Polaris 空壳）。
 *
 * 官方账号体系已移除，不再存在需要清理的 Coding Plan / Start Plan 派生 provider key，
 * 因此这里只保留「通知账号 Source 刷新」这个扩展点；凭据仓库依赖已删除。
 *
 * 装配签名保持兼容：接自有账号体系时在这里重新接入派生 key 清理即可。
 */
interface OAuthProviderLogoutDependencies {
  readonly refreshAccountProviders?: (reason: string) => Promise<unknown>;
}

export function createOAuthProviderLogoutHandler(
  dependencies: OAuthProviderLogoutDependencies = {},
): (provider: OAuthProviderId, accountIdentity?: string | null) => Promise<void> {
  return async (provider) => {
    await dependencies.refreshAccountProviders?.(`oauth-logout:${provider}`);
  };
}
