// Broker 协议（helper 侧服务端 + 调用侧客户端共用的单一事实源）。
//
// 传输：行分隔 JSON。请求 {id?, method, params?}；响应 {ok:true, result} 或
// {ok:false, error:{message, code?, details?}}。命名管道（win32）/\\./.sock（posix）。
// 方法集合 = 官方 14 工具 + 内部方法（health / permission_status / screen_capture_probe /
// close_session）。token 鉴权已按上游口径整体删除（连接门 = 私有随机管道名）。
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";

export class BrokerError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use broker is unavailable.");
    this.name = "BrokerError";
    this.code = options.code ?? "unavailable";
    if (options.details !== undefined) this.details = options.details;
  }
}

export class CuaHelperError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use Helper is unavailable.");
    this.name = "CuaHelperError";
    this.code = options.code ?? "helper_unavailable";
  }
}

export function isCuaHelperError(value) {
  return value instanceof CuaHelperError;
}

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });

export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 客户端：发一个请求，读一行响应。 */
export async function callBrokerMethod(args = {}) {
  const socketPath = typeof args.socketPath === "string" ? args.socketPath.trim() : "";
  if (!socketPath) throw new CuaHelperError("Computer Use broker socket path is missing");
  const method = typeof args.method === "string" ? args.method : "";
  if (!method) throw new CuaHelperError("Computer Use broker method is missing");
  const timeoutMs =
    Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
      ? args.timeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  const id = randomUUID();
  return await new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new BrokerError(
            `Computer Use broker request "${method}" timed out after ${timeoutMs}ms`,
            {
              code: "timeout",
            },
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, method, params: args.params ?? {} })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) {
        finish(new CuaHelperError("Computer Use broker response exceeded the 128 MiB limit"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let payload;
      try {
        payload = JSON.parse(buffer.slice(0, newline));
      } catch {
        finish(new CuaHelperError("Computer Use broker returned an invalid response"));
        return;
      }
      if (payload && typeof payload.id === "string" && payload.id !== id) {
        finish(new CuaHelperError("Computer Use broker response id mismatch"));
        return;
      }
      if (payload?.ok !== true) {
        const detail = payload?.error;
        const message =
          typeof detail === "string"
            ? detail
            : (detail?.message ?? "Computer Use broker call failed");
        finish(
          new BrokerError(message, {
            code:
              typeof detail === "object" && typeof detail?.code === "string"
                ? detail.code
                : undefined,
            details: typeof detail === "object" ? detail?.details : undefined,
          }),
        );
        return;
      }
      finish(undefined, payload.result);
    });
    socket.once("error", (error) =>
      finish(
        new CuaHelperError(`Computer Use Helper is unreachable: ${error.code ?? error.message}`),
      ),
    );
    socket.once("close", () => {
      if (!settled)
        finish(new CuaHelperError("Computer Use Helper closed before returning a response"));
    });
  });
}

/** 健康探针：带轮询（宿主在 transport_ready 后立刻探测）。 */
export async function probeHelperHealth(socketPath, options = {}) {
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 5_000;
  const pollIntervalMs =
    Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0
      ? options.pollIntervalMs
      : 100;
  const perTryTimeoutMs =
    Number.isFinite(options.perTryTimeoutMs) && options.perTryTimeoutMs > 0
      ? options.perTryTimeoutMs
      : Math.min(timeoutMs, 1_000);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      const health = await callBrokerMethod({
        socketPath,
        method: "health",
        timeoutMs: perTryTimeoutMs,
      });
      if (health && typeof health === "object") {
        return {
          bundleId: typeof health.bundleId === "string" ? health.bundleId : null,
          pid: Number.isInteger(health.pid) ? health.pid : null,
        };
      }
      lastError = new CuaHelperError(
        "Computer Use Helper health probe returned an invalid payload",
      );
    } catch (error) {
      lastError = error;
    }
    if (Date.now() + pollIntervalMs >= deadline) break;
    await sleep(pollIntervalMs);
  }
  throw lastError instanceof Error
    ? lastError
    : new CuaHelperError("Computer Use Helper health probe failed");
}

export function mintBrokerSocketPath(options = {}) {
  const token = randomUUID();
  if (process.platform === "win32") return `\\\\.\\pipe\\polaris-cua-broker-${token}`;
  const dir = typeof options.dir === "string" && options.dir !== "" ? options.dir : tmpdir();
  return join(dir, `polaris-cua-broker-${token}.sock`);
}

export function resolveBrokerSocketPath(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = env[BROKER_SOCKET_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  return mintBrokerSocketPath(options);
}

// ───────────────────────────────────────────── 服务端编解码 / 分发

export function parseRequestLine(line) {
  if (typeof line !== "string" || line.trim() === "") return undefined;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  if (typeof parsed.method !== "string" || parsed.method === "") return undefined;
  const request = { method: parsed.method };
  if (typeof parsed.id === "string" || parsed.id === null) request.id = parsed.id;
  if (parsed.params !== undefined) request.params = parsed.params;
  return request;
}

export function okResponse(result) {
  return { ok: true, result };
}

export function errorResponse(message, options = {}) {
  return {
    ok: false,
    error: { message, ...(options.code ? { code: options.code } : {}) },
  };
}

export function errorResponseFromException(error) {
  if (error && typeof error === "object" && typeof error.code === "string" && error.code !== "") {
    return {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  return errorResponse(error instanceof Error ? error.message : String(error));
}

export function serializeResponse(response) {
  return `${JSON.stringify(response)}\n`;
}

const BROKER_METHODS = new Set([
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "request_access",
  "stop_computer_control",
  "health",
  "permission_status",
  "screen_capture_probe",
  "close_session",
]);

const READ_ONLY_BROKER_METHODS = new Set([
  "list_apps",
  "list_windows",
  "get_app_state",
  "health",
  "permission_status",
  "screen_capture_probe",
]);

export function isBrokerMethod(method) {
  return typeof method === "string" && BROKER_METHODS.has(method);
}

export function isReadOnlyBrokerMethod(method) {
  return typeof method === "string" && READ_ONLY_BROKER_METHODS.has(method);
}

export async function dispatchRequest(backend, request) {
  if (!request || !isBrokerMethod(request.method)) {
    return errorResponse(
      `Computer Use broker method is not supported: ${request?.method ?? "<missing>"}`,
      {
        code: "method_not_found",
      },
    );
  }
  const handler = backend?.[request.method];
  if (typeof handler !== "function") {
    return errorResponse(`Computer Use broker method is not implemented: ${request.method}`, {
      code: "unimplemented",
    });
  }
  try {
    return okResponse(await handler.call(backend, request.params ?? {}));
  } catch (error) {
    return errorResponseFromException(error);
  }
}

export async function handleRequestLine(backend, line) {
  const request = parseRequestLine(line);
  if (!request)
    return errorResponse("Computer Use broker request is invalid", { code: "invalid_request" });
  return await dispatchRequest(backend, request);
}
