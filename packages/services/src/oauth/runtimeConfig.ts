import type { OAuthProviderId } from "@zcode/shared";

/** Provider 运行时配置（仅 host process 可见） */
export interface OAuthProviderRuntimeConfig {
  id: OAuthProviderId;
  displayName: string;
  enabled: boolean;
  order: number;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  appId: string;
  redirectUri: string;
  businessLoginUrl?: string;
  appSecret?: string;
}

/** OAuth 全局运行时配置 */
export interface OAuthRuntimeConfig {
  providers: OAuthProviderRuntimeConfig[];
}

/**
 * 从运行时环境变量生成 OAuth 配置。
 *
 * 注意：这里只能在 host process 使用，避免把敏感配置暴露给 renderer。
 *
 * Polaris：官方账号（Z.ai / BigModel）的 provider 运行时配置已剥离，这里保留装配点并返回空列表。
 * 接入自有 OAuth provider 时在此构造配置，无需改动调用方。
 */
export function createOAuthRuntimeConfig(_env: NodeJS.ProcessEnv = process.env): OAuthRuntimeConfig {
  return { providers: [] };
}
