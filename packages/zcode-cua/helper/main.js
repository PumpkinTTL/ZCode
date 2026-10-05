#!/usr/bin/env node
// Polaris Computer Use Helper（Windows dev runtime）。
//
// 被宿主用 `ELECTRON_RUN_AS_NODE` 的 Electron/Node 进程 fork：
//   <entry> --socket <named-pipe|\\.\\.\\unix.sock> --parent-pid <pid> [--exit-log <path>]
//
// 生命周期契约（windowsCuaHelperHostSupport.ts 消费）：
//   1. 管道 bind 成功后经 process.send 发 {protocol:"zcode-cua-windows-dev/v1", type:"transport_ready", socketPath, pid}；
//   2. backend 就绪（driver 可解析）后发同形状 type:"ready"；
//   3. 收到 {protocol, type:"shutdown"} 或父进程消失 → 退出 0。
//
// 传输协议（helper 侧服务端，broker.js 的 handleRequestLine）：
//   行 JSON {id?, method, params?} → 行 JSON {id, ok, result} | {id, ok:false, error:{message, code?}}。
import { rm } from "node:fs/promises";
import { createServer } from "node:net";

import { HELPER_ADDON_ENV, WINDOWS_DEV_CONTROL_PROTOCOL } from "../broker-server.js";
import { handleRequestLine, serializeResponse } from "../broker.js";
import { createBackend } from "./backend.js";
import { closeDriverSession } from "./driver.js";

function parseArgv(argv) {
  const parsed = { socket: undefined, parentPid: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--socket") parsed.socket = argv[i + 1];
    else if (arg === "--parent-pid") parsed.parentPid = Number.parseInt(argv[i + 1] ?? "", 10);
    // --exit-log 目前仅诊断用路径，接受但忽略（mac 形态参数，保持 argv 兼容）。
  }
  return parsed;
}

function sendControl(message) {
  try {
    process.send?.(message);
  } catch {
    // IPC 已断开 = 父进程离开；交给 watchdog 收口。
  }
}

async function main() {
  const { socket, parentPid } = parseArgv(process.argv.slice(2));
  if (typeof socket !== "string" || socket.trim() === "") {
    process.stderr.write("[polaris-cua-helper] --socket is required\n");
    process.exit(2);
  }
  const socketPath = socket.trim();
  const addonPath = process.env[HELPER_ADDON_ENV]?.trim();
  const backend = createBackend({ addonPath });
  let shuttingDown = false;

  const server = createServer((connection) => {
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
        connection.destroy();
        return;
      }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        void handleRequestLine(backend, line)
          .then((response) => {
            connection.write(serializeResponse(response));
          })
          .catch((error) => {
            connection.write(
              serializeResponse({
                ok: false,
                error: { message: error instanceof Error ? error.message : String(error) },
              }),
            );
          });
      }
    });
    connection.on("error", () => {
      connection.destroy();
    });
  });
  server.on("error", (error) => {
    sendControl({
      protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
      type: "error",
      message: `Computer Use Helper socket failed: ${error.code ?? error.message}`,
    });
    process.exit(1);
  });

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      server.close();
    } catch {
      // 关闭失败不阻塞退出。
    }
    closeDriverSession();
    if (process.platform !== "win32") {
      void rm(socketPath, { force: true }).catch(() => undefined);
    }
    process.exit(code);
  };

  process.on("message", (message) => {
    if (
      message &&
      typeof message === "object" &&
      message.protocol === WINDOWS_DEV_CONTROL_PROTOCOL &&
      message.type === "shutdown"
    ) {
      shutdown(0);
    }
  });
  process.on("disconnect", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));

  // 父进程 watchdog：宿主崩溃后不留孤儿（mac 侧对应 launcher-pid watchdog）。
  if (Number.isInteger(parentPid) && parentPid > 0) {
    const timer = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        shutdown(0);
      }
    }, 2_000);
    timer.unref?.();
  }

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(socketPath);
  });
  sendControl({
    protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
    type: "transport_ready",
    socketPath,
    pid: process.pid,
  });
  await backend.initialize();
  sendControl({
    protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
    type: "ready",
    socketPath,
    pid: process.pid,
  });
  // 无 IPC（本地冒烟/诊断直跑）时给 stdout 一条就绪行。
  if (!process.send) {
    process.stdout.write(`[polaris-cua-helper] ready on ${socketPath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `[polaris-cua-helper] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
