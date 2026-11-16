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
 * Polaris：官方 OAuth（zai / bigmodel）登录链路已整体移除，恒返回空配置——
 * 服务侧保持类型与装配形状，无任何官方 provider 可启用。
 */
export function createOAuthRuntimeConfig(_env: NodeJS.ProcessEnv = process.env): OAuthRuntimeConfig {
  return { providers: [] };
}
