// producer 的宿主/开发面模块（@zcode/zcode-cua/broker/server 子路径）。
//
// Windows 运行时由 services 侧 WindowsCuaHelperHost（windowsCuaDevHelperHost.ts）驱动，
// 本模块提供它消费的常量 / 工具函数；macOS 专属的 Helper 安装/签名/LaunchServices 面在本
// build 中保持 fail-closed（不发布 macOS Helper）。
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { CuaHelperError } from "./broker.js";
import { HELPER_BUNDLE_ID, HELPER_DISPLAY_NAME } from "./broker-helper-constants.js";
import { ROLE_TO_KIND, roleToKind } from "./helper/state.js";

export const HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";

const MACOS_UNAVAILABLE =
  "This surface is only implemented for the macOS Helper, which is not part of this build.";

/**
 * macOS Helper 启动参数（/usr/bin/open 形态）。Windows 由 windowsCuaHelperHostSupport
 * 直接 fork 进程（argv: <entry> --socket <path> --parent-pid <pid>），不走这里。
 */
export function buildHelperOpenArgs(spec = {}, launcherPid) {
  const args = ["-a", String(spec.appPath ?? "")];
  const helperArgs = [];
  if (typeof spec.socketPath === "string" && spec.socketPath !== "")
    helperArgs.push("--socket", spec.socketPath);
  if (typeof spec.exitLogPath === "string" && spec.exitLogPath !== "") {
    helperArgs.push("--exit-log", spec.exitLogPath);
  }
  const pid = launcherPid ?? spec.launcherPid;
  if (Number.isInteger(pid) && pid > 0) helperArgs.push("--launcher-pid", String(pid));
  if (spec.allowUnsignedLauncherLocalDev === true)
    helperArgs.push("--allow-unsigned-launcher-local-dev");
  if (spec.allowExternalBrokerClientLocalDev === true) {
    helperArgs.push("--allow-external-broker-client-local-dev");
  }
  if (helperArgs.length > 0) args.push("--args", ...helperArgs);
  return args;
}

/**
 * dev 判定：Helper bundle 用编译期常量折叠；宿主 bundle 无该 define，回退到
 * ZCODE_RUNTIME_ENV（dev 形态 = development，打包态注入 production）。
 */
export function isCuaLocalDevelopmentRuntime(env = process.env, compiledLocalDevelopmentRuntime) {
  if (compiledLocalDevelopmentRuntime === false) return false;
  return (env?.ZCODE_RUNTIME_ENV ?? "") !== "production";
}

export async function resolveHelperPermissionSubjectIdentity(appPath) {
  return {
    appPath,
    executablePath: appPath,
    displayName: HELPER_DISPLAY_NAME,
    bundleId: HELPER_BUNDLE_ID,
  };
}

export function createCuaHelperInstaller() {
  const unavailable = async () => {
    throw new CuaHelperError(MACOS_UNAVAILABLE);
  };
  return { ensureInstalled: unavailable, verifyInstalled: unavailable };
}

export const defaultCuaHelperVerifierDependencies = {
  readExecutableArchs: async () => {
    throw new CuaHelperError(MACOS_UNAVAILABLE);
  },
  verifyCodeSignature: async () => {
    throw new CuaHelperError(MACOS_UNAVAILABLE);
  },
  verifyTeamIdentifier: async () => {
    throw new CuaHelperError(MACOS_UNAVAILABLE);
  },
};

export function cuaBrokerRefreshMarkerPath(socketPath) {
  return process.platform === "win32" ? undefined : `${socketPath}.refresh`;
}

export async function publishCuaBrokerRefreshMarker(socketPath, options = {}) {
  const path = cuaBrokerRefreshMarkerPath(socketPath);
  if (!path) return { path: undefined };
  await writeFile(
    path,
    JSON.stringify({ socketPath, publishedAt: (options.now ?? Date.now)() }),
    "utf8",
  );
  return { path };
}

export function loadRealNativeAddon(options = {}) {
  const addonPath = options.addonPath ?? process.env[HELPER_ADDON_ENV]?.trim();
  if (!addonPath) {
    throw new CuaHelperError("Computer Use native addon path is missing", {
      code: "native_addon_unavailable",
    });
  }
  // Phase 1：原生操作由 cua-driver 托管；进程内 FFI 层未编译（helper/native.js 为锚点）。
  throw new CuaHelperError(
    "native addon is not compiled in this build; native operations are delegated to cua-driver",
    { code: "native_addon_unavailable" },
  );
}

export function resolvePackagedNativeAddonPath(options = {}) {
  const candidate = options.addonPath ?? process.env[HELPER_ADDON_ENV]?.trim();
  return typeof candidate === "string" && candidate !== "" && existsSync(candidate)
    ? candidate
    : undefined;
}

export function resolveInTreeAddonPath(options = {}) {
  return resolvePackagedNativeAddonPath(options);
}

/** helper 侧的只读方法装订（从 native source 反射到 broker 方法名）。 */
export function createAxReadOnlyMethods(source, registry) {
  const methods = {};
  const names = Array.isArray(registry?.readOnlyMethods)
    ? registry.readOnlyMethods
    : ["list_apps", "list_windows", "get_app_state"];
  for (const name of names) {
    if (typeof source?.[name] === "function") methods[name] = source[name].bind(source);
  }
  return methods;
}

export { ROLE_TO_KIND, roleToKind };

export class CuaHelperLifecycleManager {
  #dispose;
  #current;
  #disposed = false;
  constructor(dispose) {
    this.#dispose = dispose;
    this.#current = undefined;
  }
  async acquire(options) {
    if (typeof options?.isAdmitted === "function" && !options.isAdmitted()) {
      return undefined;
    }
    const managed = options?.create?.();
    this.#current = managed;
    return managed;
  }
  peek() {
    return this.#current;
  }
  get disposed() {
    return this.#disposed;
  }
  async dispose(managed) {
    this.#disposed = true;
    await this.#dispose?.(managed ?? this.#current);
  }
}

export class CuaProductHelperWorkspaceRegistry {
  setEnabled(_context, _enabled) {}
}

/**
 * macOS 产品 Helper 工厂（宿主为签名 .app）。本 build 不发布 macOS Helper；
 * Windows 走 services 的 WindowsCuaHelperHost，不经过此工厂。
 */
export function createProductCuaHelperHost() {
  return createUnavailableCuaHelperHost();
}

function createUnavailableCuaHelperHost() {
  const unavailableReject = async () => {
    throw new CuaHelperError(MACOS_UNAVAILABLE);
  };
  return {
    get running() {
      return false;
    },
    get socketPath() {
      return null;
    },
    get pluginAuthority() {
      return null;
    },
    get reservedTransport() {
      return undefined;
    },
    start: unavailableReject,
    stop: async () => {},
    restart: unavailableReject,
    restartAfterCurrentStart: unavailableReject,
    waitForTransport: unavailableReject,
    checkHealth: unavailableReject,
    queryScreenCaptureProbe: async () => ({ ok: false, reason: MACOS_UNAVAILABLE }),
    queryScreenRecordingPreflight: async () => undefined,
    queryPermissionStatus: async () => ({}),
  };
}

/**
 * 产品/工作区的「官方 CUA 插件是否启用」判定：本 build 未实现（内部特性
 * ZCODE_CUA_* 默认开启，node.ts 的 isCuaEnabledForContext 由它短路，不影响链路）。
 */
export function isOfficialCuaPluginEnabledForWorkspace() {
  return false;
}

/** 产品 resolver：透明转发到宿主（Windows 下即 WindowsCuaHelperHost）。 */
export function createCuaProductMcpServerResolver(host, _options = {}) {
  return {
    async resolveMcpServers(servers) {
      return servers;
    },
    async restart() {
      if (host?.restartAfterCurrentStartPreservingTransport) {
        await host.restartAfterCurrentStartPreservingTransport();
        return;
      }
      await host?.restart?.();
    },
    async restartAfterPermissionGrant() {
      if (host?.restartAfterCurrentStartPreservingTransport) {
        await host.restartAfterCurrentStartPreservingTransport();
        return;
      }
      await host?.restart?.();
    },
  };
}

/** 有界等待：超时抛 caller_timeout（调用方把它当"后台仍在跑"，不取消 startup）。 */
export async function waitForCuaHelperStartup(startup, deadlineMs = 10_000) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return await startup;
  let timer;
  try {
    return await Promise.race([
      startup,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            "caller_timeout: Computer Use Helper startup exceeded the caller deadline",
          );
          error.name = "caller_timeout";
          reject(error);
        }, deadlineMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isPotentialZCodeCuaAgentMcpServer(server) {
  if (!server || typeof server !== "object") return false;
  if (server.name === "computer-use") return true;
  const command = server.command;
  if (typeof command === "string" && /zcode-cua/u.test(command)) return true;
  if (
    Array.isArray(command) &&
    command.some((part) => typeof part === "string" && /zcode-cua/u.test(part))
  ) {
    return true;
  }
  if (
    Array.isArray(server.args) &&
    server.args.some((arg) => typeof arg === "string" && /zcode-cua/u.test(arg))
  ) {
    return true;
  }
  return false;
}

export function isScreenCaptureProbeSuccess(probe) {
  return probe?.ok === true;
}

const agentEnvUnavailableHosts = new WeakSet();

export function markCuaProductHelperAgentEnvUnavailable(host) {
  if (host && typeof host === "object") agentEnvUnavailableHosts.add(host);
}

export function hasCuaProductHelperAgentEnvUnavailable(host) {
  return Boolean(host) && typeof host === "object" && agentEnvUnavailableHosts.has(host);
}

export function clearCuaProductHelperAgentEnvUnavailable(host) {
  if (host && typeof host === "object") agentEnvUnavailableHosts.delete(host);
}

/** 孤儿 Helper 收割：Windows 侧由 Helper 的父进程 watchdog 保证（无目录契约）。 */
export async function reapOrphanedHelpers() {}

export async function requestHelperAccessibilityPermissionViaLaunchServices() {
  return { ok: false, reason: MACOS_UNAVAILABLE };
}

export async function requestHelperScreenRecordingPermissionViaLaunchServices() {
  return { ok: false, reason: MACOS_UNAVAILABLE };
}
