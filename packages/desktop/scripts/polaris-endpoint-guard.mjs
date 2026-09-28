/**
 * 构建期闸门：阻止官方（ZCode / Z.ai / BigModel）端点被烤进 Polaris 产物。
 *
 * 为什么需要它：`loadEnvFiles()` 会把**整个 process.env** 合并后交给
 * `pickProductEndpointEnv()`，而后者恰好挑 `ZCODE_BASE_URL` / `ZAI_OAUTH_ORIGIN` /
 * `ZAI_BUSINESS_BASE_URL` / `ZAI_OAUTH_CLIENT_ID` 这几个键。于是只要构建是在一个
 * 带着这些变量的 shell 里跑的（例如从 ZCode 宿主派生出来的终端），产物里的
 * `__ZCODE_ENDPOINT_ENV__` 就会是 https://zcode.z.ai / chat.z.ai / api.z.ai，
 * 把源码里的 Polaris 默认值整片盖掉——表现就是"改了品牌却还在请求官方接口"。
 *
 * 这里在进 `define` 之前把这些键里的官方域名摘掉并打印告警：摘掉之后
 * `readProductEndpointEnv()` 会自然回落到源码默认值（polaris.bitlesu.com）。
 * 需要指向官方做迁移验证时，显式设置 POLARIS_ALLOW_UPSTREAM_ENDPOINTS=1。
 */

/** 官方域名后缀；命中即视为上游端点。 */
const UPSTREAM_HOST_SUFFIXES = ["z.ai", "bigmodel.cn", "zhipuai.cn", "zcode.ai"];

/** 只为验证迁移时放行；默认关闭。 */
export const ALLOW_UPSTREAM_ENDPOINTS_ENV = "POLARIS_ALLOW_UPSTREAM_ENDPOINTS";

/** @param {string} value @returns {string | null} */
function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** @param {string} value @returns {boolean} */
function isUpstreamEndpoint(value) {
  const host = hostOf(value);
  if (!host) return false;
  return UPSTREAM_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 摘掉端点环境里的上游域名。
 *
 * 返回值**只含合法的端点键值**：这份对象会被 `JSON.stringify` 后作为 `__ZCODE_ENDPOINT_ENV__`
 * 注入产物，运行时直接展开成端点环境，所以不能夹带诊断字段（否则会以数组形式混进 env）。
 * 被摘掉的键通过 `log` 报告。
 *
 * @param {Record<string, string>} endpointEnv `pickProductEndpointEnv()` 的结果
 * @param {{ log?: (message: string) => void, allowUpstream?: boolean }} [options]
 * @returns {Record<string, string>} 过滤后的新对象；不修改入参
 */
export function rejectUpstreamEndpoints(endpointEnv, options = {}) {
  if (options.allowUpstream === true) {
    return { ...endpointEnv };
  }
  const log = options.log ?? ((message) => console.warn(message));
  const kept = {};
  const droppedKeys = [];
  for (const [key, value] of Object.entries(endpointEnv)) {
    if (isUpstreamEndpoint(value)) {
      droppedKeys.push(key);
      continue;
    }
    kept[key] = value;
  }
  if (droppedKeys.length > 0) {
    log(
      `[polaris] 已从构建端点环境中摘除上游域名：${droppedKeys.join(", ")}。` +
        `这些变量来自当前 shell 的 process.env，会把产物端点指回 Z.ai/ZCode。` +
        `摘除后回落到源码默认值（polaris.bitlesu.com）。` +
        `确需保留请设 ${ALLOW_UPSTREAM_ENDPOINTS_ENV}=1。`,
    );
  }
  return kept;
}
