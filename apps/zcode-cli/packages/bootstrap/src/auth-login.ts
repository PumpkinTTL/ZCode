import {
  createSharedZCodeCredentialStore,
  SHARED_ZCODE_CREDENTIAL_KEYS,
  type SharedZCodeCredentialStore,
} from "@zcode/adapters";
import type { EnvRecord } from "@zcode/adapters/model";

/**
 * Polaris fork：官方账号登录（Z.ai / BigModel Coding Plan OAuth、手动 API Key 连接、
 * 凭据落盘与 provider 配置写入）已整体移除，登录编排函数与适配器（cli-oauth /
 * coding-plan-api-key / browser 打开助手）一并删除。
 *
 * 这里只保留 `logout`：它只清理本地共享凭据文件，不含任何网络请求，用于把旧版本
 * 登录残留的官方 token 清干净。接自有账号体系时在此处重新实现登录编排即可。
 */

export interface LogoutZCodeCliOptions {
  credentialStore?: SharedZCodeCredentialStore;
  env?: EnvRecord;
}

export interface LogoutZCodeCliResult {
  credentialsPath: string;
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
