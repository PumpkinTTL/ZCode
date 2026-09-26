import { randomBytes } from "node:crypto";
import type { HttpClientPort, HttpClientRunOptions, TraceContext } from "@zcode/contracts";

/**
 * Polaris fork：官方账号业务已整体移除。
 *
 * 这里原先硬编码 `https://zcode.z.ai/api/v1` 作为 OAuth 基址，并会真的发起
 * `/oauth/cli/init` 与 `/oauth/cli/poll/:flowId` 请求。自有账号服务尚未就绪，
 * 因此不再指向任何官方地址，也不再发出请求：客户端工厂被调用即失败，
 * 调用方（`zcode login` / `/login`）会得到一条明确的可读错误。
 *
 * 类型与错误类保留，等自有账号服务上线后在此处接回实现。
 */
export type CliOAuthProviderId = "zai" | "bigmodel";
const POLL_TOKEN_BYTES = 32;

export interface CliOAuthClientOptions {
  baseUrl?: string;
  providerId: CliOAuthProviderId;
  httpClient: HttpClientPort;
  trace?: TraceContext;
}

export interface CliOAuthInitInput {
  pollToken: string;
}

export interface CliOAuthInitData {
  authorize_url: string;
  expires_at: number;
  flow_id: string;
  poll_interval_sec: number;
}

export interface CliOAuthPollInput {
  flowId: string;
  pollToken: string;
}

export interface CliOAuthUser {
  avatar?: string;
  email?: string;
  name?: string;
  user_id: string;
}

export interface CliOAuthReadyData {
  status: "ready";
  token: string;
  user: CliOAuthUser;
  providerId: CliOAuthProviderId;
  accessToken: string;
  refreshToken?: string;
}

export interface CliOAuthPendingData {
  status: "pending";
}

export interface CliOAuthFailedData {
  status: "failed";
}

export type CliOAuthPollData = CliOAuthFailedData | CliOAuthPendingData | CliOAuthReadyData;

export interface CliOAuthClient {
  init(input: CliOAuthInitInput, options?: HttpClientRunOptions): Promise<CliOAuthInitData>;
  poll(input: CliOAuthPollInput, options?: HttpClientRunOptions): Promise<CliOAuthPollData>;
}

export class CliOAuthError extends Error {
  readonly businessCode?: number;
  readonly httpStatus?: number;

  constructor(message: string, details: { businessCode?: number; httpStatus?: number } = {}) {
    super(message);
    this.name = "CliOAuthError";
    this.businessCode = details.businessCode;
    this.httpStatus = details.httpStatus;
  }
}

export const CLI_OAUTH_DISABLED_MESSAGE =
  "Official account sign-in is not available in Polaris. Configure a model provider with an API key instead.";

export function createCliOAuthClient(_options: CliOAuthClientOptions): CliOAuthClient {
  throw new CliOAuthError(CLI_OAUTH_DISABLED_MESSAGE);
}

export function createCliOAuthPollToken(): string {
  return randomBytes(POLL_TOKEN_BYTES).toString("hex");
}
