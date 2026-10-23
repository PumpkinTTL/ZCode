const LIVE_TEAM_SPEC = "conversation-session-r3-live-bigmodel-team.test.ts";
const LIVE_SHARE_SPEC = "conversation-session-share-ssh-artifact.test.ts";
const PRODUCTION_E2E_PROVIDER_CONFIG_ORIGIN = "https://zcode.z.ai";

export function getE2EProviderEndpointEnv(
  specs: readonly string[],
  _providerPreset: string,
  _httpMode: string,
): Record<string, string> {
  // Polaris：官方「请求安全校验」edition 已剪除；普通用例不再获得控制面覆盖
  // （开源版本就为空），只有生产账号 live 用例保留生产控制面例外。
  if (!isProductionAccountRun(specs)) return {};
  return {
    ZCODE_BASE_URL: PRODUCTION_E2E_PROVIDER_CONFIG_ORIGIN,
    ZCODE_ENDPOINT_ORIGIN: PRODUCTION_E2E_PROVIDER_CONFIG_ORIGIN,
    // 账号校验独立于 ZCode 控制面。SSH 透传 ZCODE_ENV，但不透传 BigModel 地址覆盖；
    // 仅覆盖本机地址会造成模型已可选、远端却向 bigmodel.cn 重试的半通状态。
    ZCODE_ENV: "production",
    BIGMODEL_API_BASE_URL: "https://bigmodel.cn",
  };
}

export function shouldUseProductionE2EProviderEndpoint(
  specs: readonly string[],
  providerPreset: string,
  httpMode: string,
): boolean {
  return Object.keys(getE2EProviderEndpointEnv(specs, providerPreset, httpMode)).length > 0;
}

function isProductionAccountRun(specs: readonly string[]): boolean {
  const names = specs.map((spec) => spec.replaceAll("\\", "/").split("/").at(-1));
  const liveSpec = names.find((name) => name === LIVE_TEAM_SPEC || name === LIVE_SHARE_SPEC);
  if (!liveSpec) return false;
  // 根因：live-team / SSH share 导入生产 JWT，默认测试域的 401 会清理 OAuth 并遮挡后续交互。
  // 生产控制面属于这个独立用例，不能扩散到同一 launcher 的其他 spec。
  if (!names.every((name) => name === liveSpec)) {
    throw new Error(
      `${liveSpec === LIVE_TEAM_SPEC ? "live-team" : "live-share"} 必须独立运行，不能与其他 spec 共用生产控制面`,
    );
  }
  return true;
}
