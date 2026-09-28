export const WEBFETCH_TOOL_NAME = "WebFetch";
export const DEFAULT_WEBFETCH_TIMEOUT_MS = 60_000;
export const MAX_WEBFETCH_URL_CHARS = 2_000;
export const MAX_WEBFETCH_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_INPUT_CHARS = 100_000;
export const MAX_WEBFETCH_MODEL_BYTES = 100_000;
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

// Polaris：WebFetch 的 UA 会发给任意被访问的网站，原先指向的是上游站点 zcode.ai。
// 改为自有域名，避免第三方站点把请求归属到 Z.ai。
export const WEBFETCH_USER_AGENT =
  "Polaris-WebFetch/0.1 (+https://polaris.bitlesu.com; coding-agent-cli)";
