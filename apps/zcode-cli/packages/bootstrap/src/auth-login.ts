import {
  createCodingPlanApiKeyResolver,
  createCliOAuthClient,
  createSharedZCodeCredentialStore,
  SHARED_ZCODE_CREDENTIAL_KEYS,
  type BrowserOpenResult,
  type CliOAuthInitData,
  type CliOAuthPollData,
  type CliOAuthUser,
  type SharedZCodeCredentialStore,
} from "@zcode/adapters";
import type { EnvRecord } from "@zcode/adapters/model";

/**
 * Polaris fork：官方账号登录（Z.ai / BigModel Coding Plan OAuth、手动 API Key 连接、
 * 凭据落盘与 provider 配置写入）已整体移除。
 *
 * 这里只保留**导出类型与函数签名**，让 CLI 的命令/ TUI 接线继续编译；登录类入口
 * 一律抛可读的 `ZCodeCliLoginError`，`logout` 仍清理共享凭据文件（纯本地操作）。
 * 接自有账号体系时在这里重新实现登录编排即可，调用点无需改动。
 */

export type CodingPlanProviderId = "bigmodel" | "zai";

export interface LoginZCodeCliOptions {
  providerId?: CodingPlanProviderId;
  abortSignal?: AbortSignal;
  apiKeyResolver?: ReturnType<typeof createCodingPlanApiKeyResolver>;
  baseUrl?: string;
  credentialStore?: SharedZCodeCredentialStore;
  env?: EnvRecord;
  httpClient?: Parameters<typeof createCliOAuthClient>[0]["httpClient"];
  noBrowser?: boolean;
  now?: () => number;
  onAuthorizeUrl?: (data: CliOAuthInitData) => void | Promise<void>;
  onBrowserOpen?: (result: BrowserOpenResult) => void | Promise<void>;
  onPollStatus?: (data: CliOAuthPollData) => void | Promise<void>;
  openBrowser?: (url: string) => Promise<BrowserOpenResult>;
  pollToken?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  personalProviderConfigPath?: string;
}

export interface LoginZCodeCliResult {
  browser?: BrowserOpenResult;
  configPath: string;
  credentialsPath: string;
  model: string;
  providerId: CodingPlanProviderId;
  user: CliOAuthUser;
}

export type LoginBigmodelCodingPlanOptions = Omit<LoginZCodeCliOptions, "providerId">;
export type LoginBigmodelCodingPlanResult = LoginZCodeCliResult & { providerId: "bigmodel" };

export interface ConfigureCodingPlanApiKeyOptions {
  apiKey: string;
  credentialStore?: SharedZCodeCredentialStore;
  env?: EnvRecord;
  personalProviderConfigPath?: string;
  providerId: CodingPlanProviderId;
}

export interface ConfigureCodingPlanApiKeyResult {
  configPath: string;
  model: string;
  providerId: CodingPlanProviderId;
}

export interface LogoutZCodeCliOptions {
  credentialStore?: SharedZCodeCredentialStore;
  env?: EnvRecord;
}

export interface LogoutZCodeCliResult {
  credentialsPath: string;
}

export class ZCodeCliLoginError extends Error {
  readonly code:
    | "auth_failed"
    | "auth_timeout"
    | "config_update_failed"
    | "credential_write_failed";

  constructor(
    code: ZCodeCliLoginError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "ZCodeCliLoginError";
    this.code = code;
  }
}

const LOGIN_REMOVED_MESSAGE =
  "Polaris 未接入自有账号体系，官方 Coding Plan 登录在当前版本不可用。";

/** 官方 Coding Plan 登录已移除，恒返回未配置。 */
export async function hasConfiguredStandaloneCodingPlan(
  _options: {
    credentialStore?: SharedZCodeCredentialStore;
    env?: EnvRecord;
  } = {},
): Promise<boolean> {
  return false;
}

export async function loginZCodeCli(
  _options: LoginZCodeCliOptions = {},
): Promise<LoginZCodeCliResult> {
  throw new ZCodeCliLoginError("auth_failed", LOGIN_REMOVED_MESSAGE);
}

export async function loginBigmodelCodingPlan(
  _options: LoginBigmodelCodingPlanOptions = {},
): Promise<LoginBigmodelCodingPlanResult> {
  throw new ZCodeCliLoginError("auth_failed", LOGIN_REMOVED_MESSAGE);
}

export async function configureCodingPlanApiKey(
  _options: ConfigureCodingPlanApiKeyOptions,
): Promise<ConfigureCodingPlanApiKeyResult> {
  throw new ZCodeCliLoginError("config_update_failed", LOGIN_REMOVED_MESSAGE);
}

/**
 * 清理共享凭据文件里的官方登录键。
 *
 * 这是纯本地操作（删除 access/refresh token / active provider 等），不含任何网络请求，
 * 因此保留：用户在旧版本登录过时，`zcode logout` 仍应把残留凭据清干净。
 */
export async function logoutZCodeCli(
  options: LogoutZCodeCliOptions = {},
): Promise<LogoutZCodeCliResult> {
  const credentialStore =
    options.credentialStore ?? createSharedZCodeCredentialStore({ env: options.env });
  const keys = Object.values(SHARED_ZCODE_CREDENTIAL_KEYS);
  const current = await credentialStore.loadMany(keys);
  await credentialStore.deleteIfValues(
    Object.fromEntries(
      Object.entries(current).flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
    ),
  );
  return {
    credentialsPath: credentialStore.filePath,
  };
}
