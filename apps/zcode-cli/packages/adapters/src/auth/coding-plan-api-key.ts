import type { HttpClientRunOptions, TraceContext } from "@zcode/contracts";
import type { HttpClientPort } from "@zcode/contracts";

/**
 * Polaris fork：官方账号业务已整体移除。
 *
 * 这里原先用 OAuth access token 去官方 `https://api.z.ai` 换 biz token，
 * 再走 `/api/biz/...` 取回 Coding Plan 的 API Key（bigmodel 分支同样会打官方网关）。
 * 自有账号服务尚未就绪，因此不再指向官方地址、也不再发出任何请求：
 * 解析器被调用即失败，`zcode login` 会得到一条明确的可读错误。
 *
 * 类型与错误类保留，等自有账号服务上线后在此处接回实现。
 */
export type CodingPlanFamily = "bigmodel" | "zai";

export interface CodingPlanApiKeyResolverOptions {
  httpClient: HttpClientPort;
  trace?: TraceContext;
}

export interface ResolveCodingPlanApiKeyInput {
  accessToken: string;
  family: CodingPlanFamily;
}

export interface CodingPlanApiKeyResolver {
  resolve(input: ResolveCodingPlanApiKeyInput, options?: HttpClientRunOptions): Promise<string>;
}

export class CodingPlanApiKeyError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "CodingPlanApiKeyError";
  }
}

export const CODING_PLAN_API_KEY_DISABLED_MESSAGE =
  "Official Coding Plan is not available in Polaris. Configure a model provider with an API key instead.";

export function createCodingPlanApiKeyResolver(
  _options: CodingPlanApiKeyResolverOptions,
): CodingPlanApiKeyResolver {
  throw new CodingPlanApiKeyError(CODING_PLAN_API_KEY_DISABLED_MESSAGE);
}
