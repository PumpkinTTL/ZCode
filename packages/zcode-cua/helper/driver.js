// cua-driver（trycua/cua，MIT）桥：常驻 stdio MCP 会话。
//
// 为什么不是每次 `cua-driver call`：one-shot CLI 每次都是独立会话，快照/元素 token
// 跨会话即 stale（实测 "pid X has no current snapshot"）。element_token 的整个语义
// （观察一次、多个动作复用同一索引空间）依赖同一会话 —— 所以 helper 进程内保持一个
// `cua-driver mcp` 子进程，所有工具调用共享它；子进程退出/初始化失败时下一次调用
// 自动重建（fail-closed，报错明确）。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const INITIALIZE_TIMEOUT_MS = 15_000;
const MAX_BUFFER_BYTES = 128 * 1024 * 1024;

export class DriverError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DriverError";
    this.code = options.code ?? "driver_error";
    if (options.possiblySent === true) this.possiblySent = true;
    if (options.details !== undefined) this.details = options.details;
  }
}

/** 候选路径与 Lyra 集成同源：显式改道 > 官方安装器可见目录 > 包主目录 junction > PATH。 */
export function buildDriverCandidates(env = process.env) {
  const exe = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const candidates = [];
  if (env.CUA_DRIVER_RS_INSTALL_DIR) candidates.push(join(env.CUA_DRIVER_RS_INSTALL_DIR, exe));
  if (env.LOCALAPPDATA) {
    candidates.push(join(env.LOCALAPPDATA, "Programs", "Cua", "cua-driver", "bin", exe));
  }
  const home = env.USERPROFILE || env.HOME;
  if (home) candidates.push(join(home, ".cua-driver", "packages", "current", exe));
  if (env.PATH) {
    for (const dir of env.PATH.split(process.platform === "win32" ? ";" : ":")) {
      if (dir) candidates.push(join(dir, exe));
    }
  }
  return Array.from(new Set(candidates));
}

export function resolveDriverPath(env = process.env) {
  return buildDriverCandidates(env).find((candidate) => existsSync(candidate));
}

export const DRIVER_MISSING_MESSAGE =
  "cua-driver is not installed (install: irm https://cua.ai/driver/install.ps1 | iex). " +
  "Computer Use on Windows is powered by the cua-driver desktop runtime.";

function collectResultText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function parsePayload(result) {
  // MCP 模式下结果形态与 CLI 不同：文本块是非 JSON 的树渲染；结构化元数据在
  // structuredContent（elements/snapshot_id/capture_id/…）；截图是真实 image block。
  // 逐块尝试解析 JSON 文本，取不到就退回 structuredContent；最后统一把 image 块的
  // 截图并回 payload（backend 以 screenshot_png_b64 消费）。
  const blocks = Array.isArray(result?.content) ? result.content : [];
  let payload;
  const texts = [];
  for (const block of blocks) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    texts.push(block.text);
    if (payload === undefined) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed !== null && typeof parsed === "object") payload = parsed;
      } catch {
        // 非 JSON 文本留在 texts 里给错误路径用。
      }
    }
  }
  if (
    payload === undefined &&
    result?.structuredContent &&
    typeof result.structuredContent === "object"
  ) {
    payload = result.structuredContent;
  }
  if (payload === undefined && texts.length > 0) {
    try {
      payload = JSON.parse(texts.join("\n"));
    } catch {
      payload = undefined;
    }
  }
  if (payload !== undefined) {
    if (typeof payload.screenshot_png_b64 !== "string") {
      const image = blocks.find(
        (block) => block?.type === "image" && typeof block.data === "string",
      );
      if (image) {
        payload.screenshot_png_b64 = image.data;
        payload.screenshot_mime_type = image.mimeType ?? "image/png";
      }
    }
    return payload;
  }
  return undefined;
}

class DriverSession {
  #driverPath;
  #child = null;
  #starting = null;
  #buffer = "";
  #pending = new Map();
  #nextId = 1;
  #stderrTail = "";

  constructor(driverPath) {
    this.#driverPath = driverPath;
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.id === undefined || message.id === null) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  #failAllPending(error) {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  #write(message) {
    const child = this.#child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new DriverError("cua-driver mcp session is not writable", {
        code: "driver_session_exited",
      });
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #notify(method, params) {
    try {
      this.#write({ jsonrpc: "2.0", method, params });
    } catch {
      // 通知丢失无害：下一次调用会重建会话。
    }
  }

  #request(method, params, timeoutMs) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new DriverError(`cua-driver ${method} timed out after ${timeoutMs}ms`, {
            code: "timeout",
          }),
        );
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async #ensureStarted() {
    if (this.#child && !this.#child.killed) return;
    if (this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      const child = spawn(this.#driverPath, ["mcp"], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.#child = child;
      this.#buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        this.#buffer += chunk;
        for (;;) {
          const newline = this.#buffer.indexOf("\n");
          if (newline < 0) break;
          const line = this.#buffer.slice(0, newline);
          this.#buffer = this.#buffer.slice(newline + 1);
          if (line.trim()) this.#handleLine(line);
        }
        if (Buffer.byteLength(this.#buffer) > MAX_BUFFER_BYTES) {
          this.#buffer = "";
          try {
            child.kill();
          } catch {
            // 会话在下一次调用时重建。
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-2000);
      });
      child.once("exit", () => {
        this.#child = null;
        this.#failAllPending(
          new DriverError(
            `cua-driver mcp session exited (${this.#stderrTail.slice(-300) || "no stderr"})`,
            { code: "driver_session_exited" },
          ),
        );
      });
      child.once("error", (error) => {
        this.#child = null;
        this.#failAllPending(
          new DriverError(`cua-driver mcp failed to start: ${error.message}`, {
            code: "driver_unavailable",
          }),
        );
      });
      const init = await this.#request(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "polaris-cua-helper", version: "0.6.3" },
        },
        INITIALIZE_TIMEOUT_MS,
      );
      if (init?.error) {
        try {
          child.kill();
        } catch {
          // 初始化失败按不可用处理。
        }
        throw new DriverError(
          `cua-driver mcp initialize failed: ${init.error.message ?? JSON.stringify(init.error)}`,
          { code: "driver_initialize_failed" },
        );
      }
      this.#notify("notifications/initialized", {});
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  async callTool(name, args, options = {}) {
    await this.#ensureStarted();
    const timeoutMs =
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    const response = await this.#request("tools/call", { name, arguments: args ?? {} }, timeoutMs);
    if (response?.error) {
      throw new DriverError(
        `cua-driver ${name} failed: ${response.error.message ?? JSON.stringify(response.error)}`,
        { code: "driver_call_failed", details: response.error },
      );
    }
    const result = response?.result ?? {};
    const payload = parsePayload(result);
    if (payload !== undefined) return payload;
    const text = collectResultText(result);
    if (result.isError === true || text) {
      throw new DriverError(`cua-driver ${name} failed: ${text || "no output"}`, {
        code: "driver_call_failed",
      });
    }
    return {};
  }

  dispose() {
    const child = this.#child;
    this.#child = null;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        // 已关闭。
      }
      try {
        child.kill();
      } catch {
        // 已退出。
      }
    }
  }
}

let session;

/** helper 退出路径调用：结束常驻 mcp 会话（防孤儿进程）。 */
export function closeDriverSession() {
  session?.dispose();
  session = undefined;
}

/**
 * 调一个 driver 工具（经常驻会话）。返回解析后的 payload。
 *
 * - 传输层失败（driver 缺失 / 会话退出 / 超时 / 输出不可解析）→ 抛 DriverError；
 *   超时对改 UI 的操作带 possiblySent 标记（daemon 可能已收到请求）。
 * - 工具层拒绝（refused 两形：effect / status）由 backend 的 #driverTool 归一。
 */
export function callDriver(tool, args = {}, options = {}) {
  const driverPath = options.driverPath ?? resolveDriverPath(options.env ?? process.env);
  if (!driverPath) throw new DriverError(DRIVER_MISSING_MESSAGE, { code: "driver_unavailable" });
  session ??= new DriverSession(driverPath);
  return session.callTool(tool, args, options);
}
