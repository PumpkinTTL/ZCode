import type { ProviderConfigSnapshot, ProviderSource } from "@zcode/provider";
import { AccountProviderService, createAccountProviderConfigResolver } from "@zcode/provider";

/**
 * Polaris fork：官方账号连接解析（zai / bigmodel 的套餐权益、Team 选择、Coding Plan 凭据）
 * 已整体移除。这里保留 `AccountProviderService` 装配点，但改为**空 overlay**：
 * 不产生任何账号 provider、不读取设置、不发网络请求。
 *
 * 保留它的原因是 Provider Runtime / Agent / Provider Provisioning 都依赖这个第三层 Source 的存在，
 * 直接把 `accountSource` 从 Provider Runtime 摘掉会改动 Provider 抽象层构造签名（红线）。
 * 接自有账号体系时在这里实现真正的 resolver 即可。
 */
export interface AccountProviderConfigSourceOptions {
  readonly configSource: ProviderSource<ProviderConfigSnapshot>;
}

export function createAccountProviderConfigSource(
  options: AccountProviderConfigSourceOptions,
): AccountProviderService {
  return new AccountProviderService({
    configSource: options.configSource,
    // 恒定返回「无账号连接」：空 providers 与空 states。
    resolve: createAccountProviderConfigResolver(async () => []),
  });
}
