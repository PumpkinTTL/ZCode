import type { ApiClient } from "@zcode/shared";
import type { OAuthRuntimeConfig } from "../runtimeConfig.js";
import type { OAuthProviderAdapter } from "./providerAdapter.js";

export type { OAuthProviderAdapter, OAuthProviderContext } from "./providerAdapter.js";

/**
 * Polaris：官方 OAuth（zai / bigmodel）登录链路已整体移除，provider 适配器不再存在。
 * 工厂保留原有签名（oauthService 装配点不变），恒返回空数组——服务保持类型完整但无任何
 * 官方登录能力；`readLinkedBigModel` 同理只保留形状，永远返回 undefined。
 */
export function createOAuthProviderAdapters(
  _config: OAuthRuntimeConfig,
  _options: { apiClient?: ApiClient } = {},
): OAuthProviderAdapter[] {
  return [];
}

export function readLinkedBigModel(_data: unknown): undefined {
  return undefined;
}
