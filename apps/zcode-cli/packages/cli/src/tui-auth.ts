import { loadBootstrapModule } from "./bootstrap-loader.js";
import { loadCliDotenv } from "./env.js";
import type { RunDependencies } from "./cli-types.js";

/**
 * Polaris fork：官方账号登录（Z.AI / BigModel Coding Plan）已整体移除，
 * 对应的 TUI 登录/API Key 配置入口一并删除。
 *
 * 保留 `logoutForTui`：它只做本地凭据清理，不依赖任何官方服务，
 * 在自有账号服务上线前是唯一有意义的账号操作。
 */
export async function logoutForTui(deps: RunDependencies) {
  const env = deps.env ?? process.env;
  const workingDirectory = (deps.cwd ?? process.cwd)();
  const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({
    cwd: workingDirectory,
    env,
  });

  if (dotenvResult.error) {
    throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
      cause: dotenvResult.error,
    });
  }

  const logout = deps.logoutZCodeCli ?? (await loadBootstrapModule()).logoutZCodeCli;
  return await logout({ env });
}
