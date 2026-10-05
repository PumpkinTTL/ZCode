// Computer Use runtime 客户端（@zcode/zcode-cua 主入口）。
//
// node-repl-host（server.ts:captureComputerUseRuntimeFromEnvironment）用
// createComputerUseRuntime({brokerSocketPath}) 构造；cua-broker.ts 的会话管道把
// runtime.execute({toolName, arguments, context, signal}) 映射成 Helper broker 协议的一跳，
// 返回的 MCP 结果原样交给 bridge/SDK。
import { BrokerError, CuaHelperError, callBrokerMethod } from "./broker.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const TIMEOUT_BY_METHOD = {
  get_app_state: 60_000,
  left_click_drag: 40_000,
  type: 40_000,
  paste: 40_000,
  list_apps: 30_000,
  list_windows: 20_000,
};

function errorResult(code, message, extra = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify({ code, message, ...extra }) }],
    isError: true,
  };
}

function errorResultFromException(error, toolName) {
  if (error instanceof BrokerError) {
    return errorResult(
      typeof error.code === "string" && error.code !== "" ? error.code : "internal",
      error.message,
      { method: toolName },
    );
  }
  if (error instanceof CuaHelperError) {
    return errorResult("broker_unavailable", error.message, { method: toolName });
  }
  return errorResult("internal", error instanceof Error ? error.message : String(error), {
    method: toolName,
  });
}

function normalizeResult(result) {
  if (result && typeof result === "object" && Array.isArray(result.content)) return result;
  return { content: [{ type: "text", text: JSON.stringify(result ?? {}) }] };
}

export function createComputerUseRuntime(options = {}) {
  const socketPath =
    typeof options.brokerSocketPath === "string" && options.brokerSocketPath.trim() !== ""
      ? options.brokerSocketPath.trim()
      : undefined;
  const ensureBrokerAvailable =
    typeof options.ensureBrokerAvailable === "function" ? options.ensureBrokerAvailable : undefined;
  let disposed = false;

  return {
    async execute(input) {
      if (disposed) return errorResult("broker_unavailable", "Computer Use runtime is disposed.");
      if (!socketPath) {
        return errorResult(
          "broker_unavailable",
          "Computer Use is not available in this session (broker socket missing).",
        );
      }
      if (input?.signal?.aborted) {
        return errorResult("control_stopped", "Computer Use request was aborted.");
      }
      try {
        await ensureBrokerAvailable?.();
      } catch (error) {
        return errorResult(
          "broker_unavailable",
          error instanceof Error ? error.message : String(error),
        );
      }
      const method = typeof input?.toolName === "string" ? input.toolName : "";
      try {
        const result = await callBrokerMethod({
          socketPath,
          method,
          params: input?.arguments ?? {},
          timeoutMs: TIMEOUT_BY_METHOD[method] ?? DEFAULT_TIMEOUT_MS,
        });
        return normalizeResult(result);
      } catch (error) {
        return errorResultFromException(error, method);
      }
    },

    async closeSession(context) {
      if (!socketPath || disposed) return;
      try {
        await callBrokerMethod({
          socketPath,
          method: "close_session",
          params: { sessionId: context?.sessionId ?? null },
          timeoutMs: 5_000,
        });
      } catch {
        // 关闭通知是尽力而为。
      }
    },

    async dispose() {
      disposed = true;
    },
  };
}
