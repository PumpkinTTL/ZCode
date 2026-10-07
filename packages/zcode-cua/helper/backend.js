/* eslint-disable max-lines -- 14 工具的线性实现与观察语义集中在同一后端类；拆分会把内部状态（快照/帧/索引空间）跨模块泄漏 */
// Computer Use 后端：把 broker 方法（= 官方 14 工具 + 内部方法）实现为
// cua-driver 调用 + ZCode 观察语义（state_id / 元素索引 / 帧 / possibly_sent）。
//
// 语义对齐出处：MIT 插件 scripts/computer-use-client.mjs 与 docs/computer-use.md
// （14 工具、错误码、state_id/frame/image_ref、diff 与索引保持、one-use 栅格）。
import { CUA_APP_ASSOCIATIONS_META_KEY } from "../host-display-contract.js";
import { OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY } from "../frame-contract.js";
import { callDriver, DriverError, DRIVER_MISSING_MESSAGE, resolveDriverPath } from "./driver.js";
import {
  assignIndices,
  clip,
  digestElements,
  randomToken,
  renderTreeDiff,
  renderTreeText,
  shortId,
} from "./state.js";

function opError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  if (Object.keys(extra).length > 0) error.details = extra;
  return error;
}

const CHORD_MODIFIERS = new Set(["ctrl", "shift", "alt", "win"]);
const KEY_ALIASES = {
  return: "return",
  enter: "return",
  kp_enter: "return",
  esc: "escape",
  escape: "escape",
  control: "ctrl",
  ctrl: "ctrl",
  ctrl_l: "ctrl",
  ctrl_r: "ctrl",
  control_l: "ctrl",
  control_r: "ctrl",
  alt: "alt",
  alt_l: "alt",
  alt_r: "alt",
  shift: "shift",
  shift_l: "shift",
  shift_r: "shift",
  meta: "win",
  cmd: "win",
  super: "win",
  win: "win",
  windows: "win",
  prior: "pageup",
  pageup: "pageup",
  next: "pagedown",
  pagedown: "pagedown",
  spacebar: "space",
  space: "space",
  tab: "tab",
  del: "delete",
  delete: "delete",
};

// 驱动 press_key 的词汇表只有字母/数字/命名键：把 "*" 这类需要 Shift 的字符原样交给它时，
// 会静默落到未加 Shift 的基础键位（2026-10-06 实测："*" 打出 "8"，大写 "A" 打出 "a"）。
// 这里按 US 布局先行映射成 {基础键 + shift}，并且修饰键输入一律走 foreground 投递
// （后台 PostMessage 不更新系统修饰键状态：驱动 0.33.3 实测 hotkey/press_key+modifiers
// 在 background 下丢 Ctrl/Shift——"basea" 而非全选取代；foreground 的 SendInput 路径
// 实测正确。驱动文档同款结论：Win32 加速键必须走 SendInput 才能让 TranslateAccelerator 看到）。
const US_SHIFTED_KEYS = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

function normalizeKeyToken(token) {
  const lower = String(token ?? "")
    .trim()
    .toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

function isElementTarget(target) {
  return Boolean(target) && typeof target === "object" && target.type === "element";
}

function elementTargetIndex(target) {
  return isElementTarget(target) && Number.isInteger(target.index) && target.index >= 0
    ? target.index
    : undefined;
}

const DIRECTIONS = new Set(["up", "down", "left", "right"]);

export function createBackend(options = {}) {
  return new CuaBackend(options);
}

class CuaBackend {
  #driverPath;
  #addonPath;
  #snapshots = new Map();
  #latestWindowByPid = new Map();
  #latestFrame = null;
  #pendingEffects = new Map();

  constructor(options) {
    this.#addonPath = options.addonPath;
  }

  async initialize() {
    // 预热 driver 路径；失败不阻塞 ready —— 工具调用层会给出明确诊断（fail-closed）。
    try {
      this.#driverPath = resolveDriverPath();
    } catch {
      this.#driverPath = undefined;
    }
  }

  // ───────────────────────────────────────────── 基础设施

  #resolvedDriverPath() {
    const path = this.#driverPath ?? resolveDriverPath();
    if (!path) throw opError("broker_unavailable", DRIVER_MISSING_MESSAGE);
    this.#driverPath = path;
    return path;
  }

  async #driverTool(tool, args = {}, options = {}) {
    const result = await callDriver(tool, args, {
      ...options,
      driverPath: this.#resolvedDriverPath(),
    });
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const refusal = result.refusal ?? {};
      if (result.effect === "refused" || result.status === "refused") {
        throw new DriverError(
          refusal.message ?? result.message ?? `cua-driver ${tool} refused the request`,
          {
            code:
              typeof refusal.code === "string"
                ? refusal.code
                : typeof result.code === "string"
                  ? result.code
                  : "driver_refused",
            details: result,
          },
        );
      }
      if (result.effect === "possibly_sent" || result.status === "possibly_sent") {
        throw new DriverError(
          refusal.message ?? result.message ?? `cua-driver ${tool} may already have been delivered`,
          {
            code: "timeout",
            possiblySent: true,
            details: result,
          },
        );
      }
    }
    return result;
  }

  async #listDriverApps() {
    const result = await this.#driverTool("list_apps", {});
    return Array.isArray(result.apps) ? result.apps : [];
  }

  async #windowsForPid(pid) {
    const result = await this.#driverTool("list_windows", { pid });
    return Array.isArray(result.windows) ? result.windows : [];
  }

  // ───────────────────────────────────────────── 应用 / 窗口解析

  async #resolveApp(ref) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
      throw opError("invalid_request", "app_ref is required for this action");
    }
    const apps = await this.#listDriverApps();
    if (Number.isInteger(ref.pid) && ref.pid > 0) {
      const hit = apps.find((app) => app.pid === ref.pid && app.running === true);
      if (hit) return toApp(hit);
      const windows = await this.#windowsForPid(ref.pid);
      if (windows.length > 0) {
        const windowAppName = windows[0].app_name ?? null;
        // 窗口记录给的是 EXE 名（如 "Notepad.exe"），list_apps 条目是展示名（如 "记事本"）
        // 或打包标识 —— 三级匹配：名称（忽略大小写）→ exe 词干含于 bundle_id/launch_path。
        const stem = String(windowAppName ?? "")
          .replace(/\.exe$/iu, "")
          .toLowerCase();
        const entry = windowAppName
          ? apps.find((app) => {
              const name = (app.name ?? "").toLowerCase();
              if (name === windowAppName.toLowerCase()) return true;
              if (stem === "") return false;
              const bundleId = (app.bundle_id ?? "").toLowerCase();
              const launchPath = (app.launch_path ?? "").toLowerCase();
              return bundleId.includes(stem) || launchPath.includes(stem);
            })
          : undefined;
        return {
          pid: ref.pid,
          name: windowAppName,
          bundle_id: null,
          launch_path: null,
          active: false,
          ...(typeof entry?.kind === "string" ? { kind: entry.kind } : {}),
        };
      }
      throw opError("invalid_request", `target app is not running (pid ${ref.pid})`);
    }
    if (typeof ref.bundle_id === "string" && ref.bundle_id.trim() !== "") {
      const id = ref.bundle_id.trim();
      const running = apps.find(
        (app) => app.running === true && (app.bundle_id === id || app.launch_path === id),
      );
      if (running) return toApp(running);
      const installed = apps.find((app) => app.bundle_id === id || app.launch_path === id);
      if (installed) {
        const windowHit = await this.#findWindowForApp(installed.name);
        if (windowHit) return this.#appFromWindow(windowHit, installed);
        return await this.#launchInstalled(installed);
      }
      if (id.includes("!") || /[\\/]/u.test(id) || /\.exe$/iu.test(id)) {
        return await this.#launchDirect(id.includes("!") ? { aumid: id } : { path: id });
      }
      throw opError(
        "invalid_request",
        `target app is not running, and no installed application matched "${clip(id, 120)}"`,
      );
    }
    if (typeof ref.name === "string" && ref.name.trim() !== "") {
      const name = ref.name.trim();
      const lower = name.toLowerCase();
      const runningExact = apps.find((app) => app.running === true && app.name === name);
      if (runningExact) return toApp(runningExact);
      const runningLoose = apps.find(
        (app) => app.running === true && app.name?.toLowerCase() === lower,
      );
      if (runningLoose) return toApp(runningLoose);
      const installedExact = apps.find((app) => app.name === name);
      const installedLoose = apps.find((app) => app.name?.toLowerCase() === lower);
      const windowHit = await this.#findWindowForApp(name);
      if (windowHit) return this.#appFromWindow(windowHit, installedExact ?? installedLoose);
      if (installedExact) return await this.#launchInstalled(installedExact);
      if (installedLoose) return await this.#launchInstalled(installedLoose);
      throw opError(
        "invalid_request",
        `target app is not running, and no installed application matched "${clip(name, 120)}"`,
      );
    }
    throw opError(
      "invalid_request",
      "getApp needs an app display name, a bundle id, or {name|bundle_id|pid}",
    );
  }

  async #launchInstalled(app) {
    // UWP/Win11 内置应用（记事本、计算器等）走 AUMID 激活：System32 里的同名 .exe 是
    // 立即退出的 stub（driver 文档同款结论）；AUMID 才有真实打包进程 pid。
    const aumid = deriveAumid(app);
    if (aumid) return await this.#launchDirect({ aumid }, app);
    if (typeof app.launch_path === "string" && app.launch_path !== "") {
      return await this.#launchDirect({ launch_path: app.launch_path }, app);
    }
    if (typeof app.name === "string" && app.name !== "") {
      return await this.#launchDirect({ name: app.name }, app);
    }
    throw opError("launch_failed", `"${app.name}" has no launch path; cannot start it`);
  }

  async #launchDirect(args, appHint) {
    const launched = await this.#driverTool("launch_app", args, {
      mutating: true,
      timeoutMs: 20_000,
    });
    const pid = Number.isInteger(launched?.pid) && launched.pid > 0 ? launched.pid : undefined;
    if (!pid) {
      throw opError(
        "launch_failed",
        `failed to launch "${appHint?.name ?? args.launch_path ?? args.path ?? args.bundle_id ?? args.name ?? "app"}"`,
      );
    }
    await this.#awaitWindow(pid, 6_000);
    // UWP 判定：显式 aumid / shell:appsFolder 启动路径，或 list_apps 条目自带 kind。
    const launchedKind =
      typeof appHint?.kind === "string"
        ? appHint.kind
        : args.aumid !== undefined || String(args.launch_path ?? "").includes("shell:appsFolder")
          ? "uwp"
          : undefined;
    return {
      pid,
      name: appHint?.name ?? launched.name ?? null,
      bundle_id: launched.bundle_id ?? appHint?.bundle_id ?? null,
      launch_path: appHint?.launch_path ?? null,
      active: launched.active === true,
      ...(launchedKind !== undefined ? { kind: launchedKind } : {}),
    };
  }

  async #awaitWindow(pid, budgetMs) {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      const windows = await this.#windowsForPid(pid);
      if (windows.length > 0) return windows;
      if (Date.now() >= deadline) return [];
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  // UWP 打包应用在 list_apps 里恒报 running:false / pid:0（驱动以可见顶层窗口推导 running，
  // UWP 窗口归 ApplicationFrameHost 承载）。若直接按"已安装"路径开工，每次绑定都会新开一个
  // 实例（2026-10-06 实测堆出 18 个计算器窗口）。绑定前先用窗口清单确认真实运行态，
  // 命中则返回 {pid, window_id} 形态的引用——正是官方给出的可靠绑定方式。
  async #findWindowForApp(name) {
    if (typeof name !== "string" || name.trim() === "") return undefined;
    let windows;
    try {
      const result = await this.#driverTool("list_windows", {});
      windows = Array.isArray(result.windows) ? result.windows : [];
    } catch {
      return undefined;
    }
    const lower = name.trim().toLowerCase();
    const candidates = windows.map((window) => ({
      window,
      haystack: `${String(window.app_name ?? "")}\u0000${String(window.title ?? "")}`.toLowerCase(),
    }));
    const exact = candidates.find((entry) =>
      entry.haystack.split("\u0000").some((part) => part.trim() === lower),
    );
    if (exact) return exact.window;
    // UWP 的窗口 app_name/标题只会有一侧对上展示名（如 "Windows 计算器" vs 标题 "计算器"），
    // 双向包含都算命中；取第一个匹配，调用方随后用 window_id 精确定位。
    return candidates.find((entry) => {
      const parts = entry.haystack.split("\u0000").filter((part) => part.trim() !== "");
      return parts.some((part) => part.includes(lower) || lower.includes(part));
    })?.window;
  }

  #appFromWindow(windowRow, appHint) {
    return {
      pid: windowRow.pid,
      name: windowRow.app_name ?? appHint?.name ?? null,
      bundle_id: appHint?.bundle_id ?? null,
      launch_path: appHint?.launch_path ?? null,
      active: false,
      window_id: windowRow.window_id,
      ...(typeof appHint?.kind === "string" ? { kind: appHint.kind } : {}),
    };
  }

  async #pickWindow(pid, requestedWindowId) {
    const windows = await this.#windowsForPid(pid);
    if (requestedWindowId !== undefined && requestedWindowId !== null) {
      const hit = windows.find((window) => window.window_id === requestedWindowId);
      if (!hit) {
        throw opError(
          "element_unavailable",
          `Window ${requestedWindowId} of pid ${pid} could not be resolved; call list_windows for a fresh window_id.`,
        );
      }
      return hit;
    }
    const onScreen = windows.filter((window) => window.is_on_screen !== false);
    const candidates = onScreen.length > 0 ? onScreen : windows;
    if (candidates.length === 0) {
      throw opError(
        "element_unavailable",
        `pid ${pid} has no open window to observe; open a window and observe again.`,
      );
    }
    // 主窗口启发 = 最前台（z_index 最大；driver 推荐的前台候选口径）。
    return candidates.reduce(
      (best, window) => ((window.z_index ?? -1) > (best.z_index ?? -1) ? window : best),
      candidates[0],
    );
  }

  // ───────────────────────────────────────────── 观察

  async #observe({ appRef, includeScreenshot, disableDiffing, treeShownToModel }) {
    const app = await this.#resolveApp(appRef);
    const window = await this.#pickWindow(app.pid, appRef?.window_id);
    const driverState = await this.#driverTool(
      "get_window_state",
      {
        pid: app.pid,
        window_id: window.window_id,
        include_screenshot: includeScreenshot === true,
      },
      { timeoutMs: 60_000 },
    );
    const rawElements = Array.isArray(driverState.elements) ? driverState.elements : [];
    const windowKey = `${app.pid}:${window.window_id}`;
    const previous = this.#snapshots.get(windowKey);
    const full = disableDiffing === true || previous === undefined;
    const assigned = assignIndices(previous, rawElements, full);
    const snapshot = {
      stateId: shortId("st"),
      windowKey,
      pid: app.pid,
      windowId: window.window_id,
      appName: driverState.app_name ?? window.app_name ?? app.name ?? null,
      appBundleId: app.bundle_id ?? null,
      windowTitle: driverState.window_title ?? window.title ?? null,
      driverSnapshotId:
        typeof driverState.snapshot_id === "string" ? driverState.snapshot_id : undefined,
      elements: assigned.elements,
      byIndex: assigned.byIndex,
      indexByKey: assigned.indexByKey,
      nextIndex: assigned.nextIndex,
      shownToModel: treeShownToModel !== false,
      digest: digestElements(assigned.elements),
      frame: previous?.frame,
      screenshot: undefined,
    };
    if (includeScreenshot === true && typeof driverState.screenshot_png_b64 === "string") {
      snapshot.frame = {
        frameId: shortId("fr"),
        authority: randomToken(16),
        captureId: typeof driverState.capture_id === "string" ? driverState.capture_id : null,
        width: driverState.screenshot_width ?? null,
        height: driverState.screenshot_height ?? null,
        consumed: false,
      };
      snapshot.screenshot = {
        data: driverState.screenshot_png_b64,
        mimeType: driverState.screenshot_mime_type ?? "image/png",
      };
      this.#latestFrame = { ...snapshot.frame, windowKey };
    }
    const diffEligible = !full && previous.shownToModel === true && disableDiffing !== true;
    const mode = diffEligible ? "diff" : "full";
    snapshot.baseStateId = diffEligible ? previous.stateId : undefined;
    snapshot.rendered = diffEligible
      ? renderTreeDiff(previous, snapshot)
      : renderTreeText(snapshot);
    this.#snapshots.set(windowKey, snapshot);
    this.#latestWindowByPid.set(app.pid, windowKey);
    let advisory = "";
    const pending = this.#pendingEffects.get(windowKey);
    if (pending) {
      this.#pendingEffects.delete(windowKey);
      if (snapshot.digest === pending.beforeDigest) {
        advisory =
          "[effect_evidence unchanged] The UI did not change after the last action. " +
          "Do not repeat the same coordinate action — target an element index or use the keyboard instead.";
      }
    }
    if (includeScreenshot === true && !snapshot.screenshot) {
      advisory = `${advisory ? `${advisory}\n` : ""}[screenshot unavailable: the driver returned no raster for this window]`;
    }
    return { app, mode, snapshot, advisory };
  }

  #observationResult(snapshot, { mode, advisory, includeScreenshot }) {
    const content = [];
    const meta = {
      [CUA_APP_ASSOCIATIONS_META_KEY]: {
        mode: "primary",
        primary: {
          appKey: snapshot.appBundleId ?? snapshot.appName ?? `pid:${snapshot.pid}`,
          displayName: snapshot.appName ?? `pid ${snapshot.pid}`,
        },
      },
    };
    if (includeScreenshot === true && snapshot.screenshot) {
      content.push({
        type: "image",
        data: snapshot.screenshot.data,
        mimeType: snapshot.screenshot.mimeType,
      });
      content.push({
        type: "text",
        text: JSON.stringify({
          image_ref: {
            frame_id: snapshot.frame.frameId,
            authority: snapshot.frame.authority,
            width: snapshot.frame.width,
            height: snapshot.frame.height,
          },
        }),
      });
      meta[OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY] = {
        schema: 1,
        frame_id: snapshot.frame.frameId,
        issued_at: new Date().toISOString(),
      };
    }
    const text = `${snapshot.rendered}${advisory ? `\n${advisory}` : ""}`;
    content.push({ type: "text", text });
    const structuredContent = {
      state_id: snapshot.stateId,
      app: { pid: snapshot.pid, name: snapshot.appName, bundle_id: snapshot.appBundleId },
      window: { window_id: snapshot.windowId, title: snapshot.windowTitle },
      elements: snapshot.elements.map((element) => ({
        index: element.index,
        kind: element.kind,
        title: element.title,
        value: element.value,
        actions: element.actions,
      })),
      text: snapshot.rendered,
      snapshot_mode: mode,
      ...(snapshot.baseStateId ? { base_state_id: snapshot.baseStateId } : {}),
      ...(snapshot.screenshot ? {} : {}),
    };
    return { content, structuredContent, _meta: meta };
  }

  // ───────────────────────────────────────────── 目标 / 帧

  async #actionContext(appRef, target) {
    if (appRef !== undefined && appRef !== null) {
      const app = await this.#resolveApp(appRef);
      const windowKey = this.#latestWindowByPid.get(app.pid);
      const snapshot = windowKey ? this.#snapshots.get(windowKey) : undefined;
      return {
        app,
        snapshot,
        windowKey: snapshot?.windowKey,
        windowId: snapshot?.windowId ?? appRef?.window_id,
      };
    }
    if (isElementTarget(target)) {
      throw opError("invalid_request", "element targets require app_ref");
    }
    const frame =
      typeof target?.frame_id === "string" ? this.#frameById(target.frame_id) : this.#latestFrame;
    if (!frame) {
      throw opError(
        "stale_frame",
        "no actionable frame is available in this transport — take a screenshot observation first.",
      );
    }
    const snapshot = this.#snapshots.get(frame.windowKey);
    if (!snapshot) {
      throw opError("stale_frame", "the frame's window is no longer observed; observe again.");
    }
    return {
      app: {
        pid: snapshot.pid,
        name: snapshot.appName,
        bundle_id: snapshot.appBundleId,
        launch_path: null,
        active: false,
      },
      snapshot,
      windowKey: frame.windowKey,
      windowId: snapshot.windowId,
    };
  }

  #frameById(frameId) {
    const frame = this.#latestFrame;
    if (!frame || frame.frameId !== frameId) {
      throw opError(
        "stale_frame",
        "that frame is stale — it was replaced by a newer raster; observe again for a current one.",
      );
    }
    return frame;
  }

  #admitCoordinate(ctx, target, { consume }) {
    if (
      !target ||
      typeof target !== "object" ||
      target.type !== "coordinate" ||
      !Number.isInteger(target.x) ||
      !Number.isInteger(target.y) ||
      target.x < 0 ||
      target.y < 0
    ) {
      throw opError(
        "invalid_request",
        'coordinate target must be {type:"coordinate", x, y} with non-negative integer pixels of the latest raster',
      );
    }
    const frame =
      typeof target.frame_id === "string" ? this.#frameById(target.frame_id) : this.#latestFrame;
    if (!frame) {
      throw opError(
        "stale_frame",
        "no actionable frame is available in this transport — take a screenshot observation first.",
      );
    }
    if (frame.consumed) {
      throw opError(
        "stale_frame",
        "the latest raster has already been used for a coordinate action; observe again for a current raster.",
      );
    }
    if (ctx.windowKey !== undefined && frame.windowKey !== ctx.windowKey) {
      throw opError(
        "stale_frame",
        `the frame belongs to a different window (${frame.windowKey}); observe the target app again.`,
      );
    }
    if (consume) frame.consumed = true;
    return { x: target.x, y: target.y, captureId: frame.captureId, frame };
  }

  #snapshotElement(ctx, index) {
    if (ctx.snapshot === undefined) {
      throw opError(
        "element_unavailable",
        `no accessibility state has been observed for ${ctx.app.name ?? `pid ${ctx.app.pid}`} yet; observe first.`,
      );
    }
    const element = ctx.snapshot.byIndex.get(index);
    if (!element) {
      throw opError(
        "element_unavailable",
        `Element ${index} is no longer available; observe again for a current tree.`,
      );
    }
    return element;
  }

  #tokenFor(ctx, index) {
    const element = this.#snapshotElement(ctx, index);
    if (typeof element.token !== "string" || element.token === "") {
      throw opError(
        "element_unavailable",
        `Element ${index} does not expose an actionable handle; observe again.`,
      );
    }
    return element.token;
  }

  // ───────────────────────────────────────────── 错误归一 / 结果封装

  #normalizeActionError(error) {
    if (!(error instanceof DriverError)) return error;
    const message = error.message ?? "";
    if (error.code === "driver_unavailable") return opError("broker_unavailable", message);
    if (error.code === "timeout" || error.possiblySent === true) {
      return opError(
        "timeout",
        `${message} (the action may already have been delivered — observe before retrying)`,
        { dispatch_status: "possibly_sent", action_sent: true },
      );
    }
    const details = error.details ?? {};
    const driverCode = typeof details.code === "string" ? details.code : error.code;
    if (/stale|superseded|invalidated/u.test(message)) {
      return opError("element_unavailable", `${message} Observe again for a current tree.`, {
        driverCode,
      });
    }
    if (/no window/u.test(message)) return opError("element_unavailable", message, { driverCode });
    if (/element_token|get_window_state/u.test(message)) {
      return opError("element_unavailable", message, { driverCode });
    }
    if (/settable|value.?pattern/iu.test(message))
      return opError("not_settable", message, { driverCode });
    return opError("internal", message, { driverCode });
  }

  async #actionReceipt(ctx, params, beforeDigest, extra) {
    if (ctx.windowKey !== undefined && typeof beforeDigest === "string") {
      this.#pendingEffects.set(ctx.windowKey, { beforeDigest });
    }
    const outcome = { action_sent: true, dispatch_status: "sent", ...extra };
    const content = [{ type: "text", text: JSON.stringify({ ok: true, ...outcome }) }];
    let structuredContent = { action_outcome: outcome };
    const returnState =
      params.return_state === "compact" || params.return_state === "full"
        ? params.return_state
        : "none";
    if (returnState !== "none") {
      const { mode, snapshot, advisory } = await this.#observe({
        appRef: {
          pid: ctx.app.pid,
          ...(ctx.windowId !== undefined ? { window_id: ctx.windowId } : {}),
        },
        includeScreenshot: false,
        disableDiffing: false,
        treeShownToModel: true,
      });
      const observation = this.#observationResult(snapshot, {
        mode,
        advisory,
        includeScreenshot: false,
      });
      content.push(...observation.content);
      structuredContent = { ...observation.structuredContent, action_outcome: outcome };
    }
    return { content, structuredContent };
  }

  // ───────────────────────────────────────────── broker 方法

  async health() {
    return {
      bundleId: null,
      pid: process.pid,
      driverPath: this.#driverPath ?? null,
      addonPath: this.#addonPath ?? null,
      platform: "win32",
    };
  }

  async permission_status() {
    // Windows 无 TCC 形态的授权；driver 侧也不需要 OS 权限（UIA 直读）。
    return {
      grant_owner: null,
      accessibility: "granted",
      accessibility_probe_ok: true,
      screen_recording: "granted",
      screen_capture_probe_ok: true,
      platform: "win32",
    };
  }

  async screen_capture_probe() {
    return { ok: true, platform: "win32" };
  }

  async close_session() {
    return { closed: true };
  }

  async list_apps() {
    const apps = await this.#listDriverApps();
    const mapped = apps.map((app) => ({
      pid: app.pid ?? 0,
      name: app.name ?? null,
      bundle_id: app.bundle_id ?? null,
      active: app.active === true,
      running: app.running === true,
      ...(typeof app.kind === "string" ? { kind: app.kind } : {}),
      ...(typeof app.launch_path === "string" ? { launch_path: app.launch_path } : {}),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ apps: mapped }) }],
      structuredContent: { apps: mapped },
    };
  }

  async list_windows(params = {}) {
    const app = await this.#resolveApp(params.app_ref);
    const windows = await this.#windowsForPid(app.pid);
    const rows = windows.map((window, index) => ({
      window_id: window.window_id,
      title: window.title ?? "",
      pid: window.pid,
      app_name: window.app_name ?? app.name,
      bounds: [
        window.bounds?.x ?? 0,
        window.bounds?.y ?? 0,
        window.bounds?.width ?? 0,
        window.bounds?.height ?? 0,
      ],
      onscreen: window.is_on_screen !== false,
      minimized: window.minimized === true,
      z_index: window.z_index ?? null,
      index,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ windows: rows }) }],
      structuredContent: { windows: rows },
    };
  }

  async get_app_state(params = {}) {
    const { mode, snapshot, advisory } = await this.#observe({
      appRef: params.app_ref,
      includeScreenshot: params.include_screenshot === true,
      disableDiffing: params.disable_diffing === true,
      treeShownToModel: params.tree_shown_to_model !== false,
    });
    return this.#observationResult(snapshot, {
      mode,
      advisory,
      includeScreenshot: params.include_screenshot === true,
    });
  }

  async left_click(params = {}) {
    const strategy =
      params.strategy === "event" || params.strategy === "a11y" ? params.strategy : "auto";
    const ctx = await this.#actionContext(params.app_ref, params.target);
    const args = { pid: ctx.app.pid };
    let pixelDispatch = false;
    if (isElementTarget(params.target)) {
      args.element_token = this.#tokenFor(ctx, elementTargetIndex(params.target));
    } else {
      const pixel = this.#admitCoordinate(ctx, params.target, { consume: true });
      args.x = pixel.x;
      args.y = pixel.y;
      if (pixel.captureId) args.capture_id = pixel.captureId;
      // 坐标是窗口局部像素：多窗口 pid 必须显式带窗口（与 scroll 同一契约）。
      if (ctx.windowId !== undefined) args.window_id = ctx.windowId;
      args.delivery_mode = strategy === "event" ? "foreground" : "background";
      pixelDispatch = true;
    }
    if (params.mouse_button === "right") args.button = "right";
    else if (params.mouse_button === "middle") args.button = "middle";
    const count = Number.isInteger(params.click_count) ? params.click_count : 1;
    if (count > 1) args.count = Math.min(count, 3);
    if (typeof params.modifiers === "string" && params.modifiers.trim() !== "") {
      // 驱动 click 自带 modifier 数组（cmd/shift/option|alt/ctrl）；此前本层直接拒绝，
      // 现按驱动能力透传，并归一少量别名。元素目标的 invoke 不带修饰语义，仅坐标点击生效。
      const modifierAliases = {
        control: "ctrl",
        option: "alt",
        win: "cmd",
        super: "cmd",
        meta: "cmd",
      };
      args.modifier = params.modifiers
        .split(/[+,]/u)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean)
        .map((token) => modifierAliases[token] ?? token);
    }
    const beforeDigest = ctx.snapshot?.digest;
    try {
      await this.#driverTool("click", args, { mutating: true, timeoutMs: 30_000 });
    } catch (error) {
      const backgroundUnavailable =
        error instanceof DriverError &&
        (error.code === "background_unavailable" ||
          /background_unavailable/u.test(error.message ?? ""));
      if (backgroundUnavailable && pixelDispatch) {
        if (strategy === "auto") {
          args.delivery_mode = "foreground";
          await this.#driverTool("click", args, { mutating: true, timeoutMs: 30_000 });
        } else if (strategy === "a11y") {
          throw opError(
            "foreground_required",
            "The driver refused background delivery for this target. " +
              'Retry the same action with strategy: "event", or target an element index.',
            { driverCode: "background_unavailable" },
          );
        } else {
          throw this.#normalizeActionError(error);
        }
      } else {
        // UWP 承载窗口（ApplicationFrameHost）会拒绝像素坐标点击（2026-10-06 实测：与窗口
        // 数量、是否前台无关）。官方路径本就推荐 element_token —— 按截图坐标在最近一次观察里
        // 找命中元素，改走 A11Y 点击；possible_sent 绝不重试，找不到命中元素时保留原始错误。
        const refused =
          error instanceof DriverError &&
          error.possiblySent !== true &&
          (error.code === "driver_refused" ||
            /refus/iu.test(String(error.code ?? "") + (error.message ?? "")));
        if (refused) {
          const fallbackReceipt = await this.#clickElementAtPointFallback(ctx, params, args);
          if (fallbackReceipt) return fallbackReceipt;
        }
        throw this.#normalizeActionError(error);
      }
    }
    return await this.#actionReceipt(ctx, params, beforeDigest, {});
  }

  // 坐标点击被拒后的 A11Y 兜底：在最近快照里找落点命中的最深元素（screenshot_frame 与
  // click 的 x/y 同为窗口局部截图像素空间），用其 token 走元素点击。找不到返回 undefined。
  async #clickElementAtPointFallback(ctx, params, args) {
    if (args.element_token !== undefined) return undefined;
    const x = args.x;
    const y = args.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const elements = ctx.snapshot?.elements;
    if (!Array.isArray(elements)) return undefined;
    let best;
    for (const element of elements) {
      const frame = element?.screenshot_frame;
      const token = element?.token;
      if (
        !frame ||
        typeof token !== "string" ||
        !Number.isFinite(frame.x) ||
        !Number.isFinite(frame.y) ||
        x < frame.x ||
        x > frame.x + frame.w ||
        y < frame.y ||
        y > frame.y + frame.h
      ) {
        continue;
      }
      if (!best || (element.depth ?? 0) >= (best.element.depth ?? 0)) best = { element };
    }
    if (!best) return undefined;
    try {
      await this.#driverTool(
        "click",
        { pid: ctx.app.pid, element_token: best.element.token },
        { mutating: true, timeoutMs: 30_000 },
      );
    } catch {
      // 兜底也失败时保留原始坐标错误（上层归一化输出）。
      return undefined;
    }
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  async scroll(params = {}) {
    const ctx = await this.#actionContext(params.app_ref, params.target);
    const direction = String(params.scroll_direction ?? "").toLowerCase();
    if (!DIRECTIONS.has(direction)) {
      throw opError(
        "invalid_request",
        `scroll direction must be up, down, left or right (got ${params.scroll_direction})`,
      );
    }
    if (isElementTarget(params.target)) {
      this.#snapshotElement(ctx, elementTargetIndex(params.target));
    } else if (params.target?.type === "coordinate") {
      this.#admitCoordinate(ctx, params.target, { consume: false });
    }
    const pages = Number(params.scroll_amount);
    const amount = Math.max(1, Math.min(50, Math.round(Number.isFinite(pages) ? pages : 1)));
    const args = { pid: ctx.app.pid, direction, by: "page", amount };
    // 多窗口 pid 下驱动要求显式 window_id，否则拒绝并报 ambiguous_window_target（实测 2026-10-06）。
    if (ctx.windowId !== undefined) args.window_id = ctx.windowId;
    await this.#driverTool("scroll", args, { mutating: true });
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  async left_click_drag(params = {}) {
    const ctx = await this.#actionContext(params.app_ref, params.from_target);
    const from = this.#dragPoint(ctx, params.from_target, "from");
    const to = this.#dragPoint(ctx, params.to, "to");
    if (params.modifiers) {
      throw opError(
        "action_unavailable",
        "drag modifiers are not supported on Windows in this build.",
      );
    }
    const dragArgs = {
      pid: ctx.app.pid,
      from_x: from.x,
      from_y: from.y,
      to_x: to.x,
      to_y: to.y,
    };
    if (ctx.windowId !== undefined) dragArgs.window_id = ctx.windowId;
    await this.#driverTool("drag", dragArgs, { mutating: true, timeoutMs: 30_000 });
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  #dragPoint(ctx, target, label) {
    if (isElementTarget(target)) {
      const element = this.#snapshotElement(ctx, elementTargetIndex(target));
      const frame = element.screenshot_frame;
      if (!frame) {
        throw opError(
          "element_unavailable",
          `Element ${target.index} has no raster frame; drag ${label} needs coordinates.`,
        );
      }
      return { x: Math.round(frame.x + frame.w / 2), y: Math.round(frame.y + frame.h / 2) };
    }
    const pixel = this.#admitCoordinate(ctx, target, { consume: false });
    return { x: pixel.x, y: pixel.y };
  }

  async type(params = {}) {
    const ctx = await this.#actionContext(params.app_ref, params.target);
    if (typeof params.text !== "string") throw opError("invalid_request", "type requires text");
    let token;
    if (isElementTarget(params.target)) {
      token = this.#tokenFor(ctx, elementTargetIndex(params.target));
    } else if (ctx.app.kind === "uwp") {
      // XAML/UWP 目标的 type_text 必须带 element_token（驱动经 UIA ValuePattern.SetValue
      // 写入；PostMessage WM_CHAR 到不了这类目标的输入管线）。无元素目标时从快照自动挑。
      token = await this.#resolveXamlEditableToken(ctx, params.app_ref);
    }
    const args = { pid: ctx.app.pid, text: params.text };
    if (token !== undefined) {
      args.element_token = token;
    } else if (ctx.windowId !== undefined) {
      // 多窗口 pid 需要显式窗口；元素 token 自身携带窗口，不与它并用（驱动契约）。
      args.window_id = ctx.windowId;
    }
    try {
      await this.#driverTool("type_text", args, { mutating: true });
    } catch (error) {
      // 兜底：kind 未识别成 uwp 时，驱动对 XAML 目标仍会给出可识别的报错
      // （"XAML/UWP target ... requires element_token"）→ 换元素路径重试一次。
      if (/XAML|UWP|element_token/iu.test(String(error?.message ?? ""))) {
        const fallbackToken = await this.#resolveXamlEditableToken(ctx, params.app_ref);
        if (fallbackToken !== undefined) {
          await this.#driverTool(
            "type_text",
            { pid: ctx.app.pid, text: params.text, element_token: fallbackToken },
            { mutating: true },
          );
          return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
        }
      }
      throw this.#normalizeActionError(error);
    }
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  // XAML/UWP 目标的自动元素解析：快照里挑 kind=document/textfield 且可写（actions 含
  // set_value）的最深元素；没有快照先做一次内部观察（treeShownToModel=false，不计入
  // "模型已见"基线）。挑不到返回 undefined，让驱动给出它自己的可操作错误。
  async #resolveXamlEditableToken(ctx, appRef) {
    let snapshot = ctx.snapshot;
    if (!snapshot) {
      await this.#observe({ appRef, includeScreenshot: false, treeShownToModel: false });
      const windowKey = this.#latestWindowByPid.get(ctx.app.pid);
      snapshot = windowKey ? this.#snapshots.get(windowKey) : undefined;
    }
    const candidates = (snapshot?.elements ?? []).filter(
      (element) =>
        (element.kind === "document" || element.kind === "textfield") &&
        Array.isArray(element.actions) &&
        element.actions.includes("set_value") &&
        typeof element.token === "string",
    );
    if (candidates.length === 0) return undefined;
    return candidates.reduce((best, element) =>
      (element.depth ?? 0) > (best.depth ?? 0) ? element : best,
    ).token;
  }

  async key(params = {}) {
    const ctx = await this.#actionContext(params.app_ref);
    if (typeof params.text !== "string" || params.text.trim() === "") {
      throw opError("invalid_request", "key requires a key or chord");
    }
    if (params.hold_seconds !== undefined) {
      throw opError(
        "action_unavailable",
        "hold_seconds is not supported on Windows in this build; use repeat instead.",
      );
    }
    const rawTokens = params.text
      .split("+")
      .map((token) => token.trim())
      .filter(Boolean);
    const rawKey = rawTokens.at(-1) ?? "";
    let key = normalizeKeyToken(rawKey);
    let modifiers = rawTokens.slice(0, -1).map(normalizeKeyToken);
    // 单字符补映射：大写字母与 US 布局 Shift 字符 → 基础键 + shift。否则驱动会把
    // "*" 当 "8"、把 "A" 当 "a"（词表里没有这些字符，静默降级）。也覆盖 ctrl+* 这类组合。
    if (rawKey.length === 1) {
      if (/^[A-Z]$/u.test(rawKey)) {
        key = rawKey.toLowerCase();
        modifiers = [...modifiers, "shift"];
      } else if (US_SHIFTED_KEYS[rawKey] !== undefined) {
        key = US_SHIFTED_KEYS[rawKey];
        modifiers = [...modifiers, "shift"];
      }
    }
    if (!key || modifiers.some((modifier) => !CHORD_MODIFIERS.has(modifier))) {
      throw opError("invalid_request", `unsupported key chord: ${params.text}`);
    }
    const repeat =
      Number.isInteger(params.repeat) && params.repeat > 0 ? Math.min(params.repeat, 50) : 1;
    for (let i = 0; i < repeat; i += 1) {
      await this.#pressKey(ctx, key, modifiers);
    }
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  /**
   * 唯一按键原语。为什么不直接调驱动的 hotkey：驱动 0.33.3 对 XAML/UWP 目标的热键只做
   * UIA 加速键匹配，匹配不到直接拒绝且**不降级到 SendInput**（实测错误原文：could not find
   * a UIA AcceleratorKey ... PostMessage WM_KEYDOWN/UP is ignored by this target's input
   * pipeline；delivery_mode:foreground 在该分支根本走不到）。而 press_key 的
   * modifiers + foreground（SendInput）在经典与 XAML 目标上都实测正确（2026-10-06 两组
   * 矩阵：Shift 字符/大写/Ctrl+A/Ctrl+V 全部落地）。所以修饰键输入一律走它。
   * XAML 目标的普通按键在 background 会被静默吞掉（PostMessage 到不了其输入管线），
   * 故 kind=uwp 走 foreground；经典目标无修饰键时保留 background（不抢焦点）。
   */
  async #pressKey(ctx, key, modifiers = []) {
    const args = { pid: ctx.app.pid, key };
    if (ctx.windowId !== undefined) args.window_id = ctx.windowId;
    if (modifiers.length > 0) args.modifiers = [...modifiers];
    if (modifiers.length > 0 || ctx.app.kind === "uwp") args.delivery_mode = "foreground";
    await this.#driverTool("press_key", args, { mutating: true });
  }

  async set_value(params = {}) {
    const ctx = await this.#actionContext(params.app_ref, params.target);
    if (typeof params.value !== "string")
      throw opError("invalid_request", "set_value requires a string value");
    const index = elementTargetIndex(params.target);
    if (index === undefined)
      throw opError("invalid_request", "set_value requires an element target");
    const token = this.#tokenFor(ctx, index);
    try {
      await this.#driverTool(
        "set_value",
        { pid: ctx.app.pid, element_token: token, value: params.value },
        { mutating: true },
      );
    } catch (error) {
      throw this.#normalizeActionError(error);
    }
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  async select_text(params = {}) {
    const ctx = await this.#actionContext(params.app_ref, params.target);
    const index = elementTargetIndex(params.target);
    if (index === undefined) {
      throw opError("invalid_request", "select_text requires an element target");
    }
    // 近似实现：先按元素聚焦（A11Y invoke），再发 Ctrl+A（统一按键原语：修饰键必走
    // foreground/SendInput，后台 PostMessage 会丢 Ctrl；XAML 目标上 hotkey 分支亦不可用）。
    // 对可编辑元素语义等价于"选中该元素全部文本"，对不可编辑元素驱动/目标会拒绝，错误如实上抛。
    const token = this.#tokenFor(ctx, index);
    await this.#driverTool(
      "click",
      { pid: ctx.app.pid, element_token: token },
      { mutating: true, timeoutMs: 30_000 },
    );
    await this.#pressKey(ctx, "a", ["ctrl"]);
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  async perform_action(params = {}) {
    const ctx = await this.#actionContext(params.app_ref, params.target);
    const index = elementTargetIndex(params.target);
    if (index === undefined)
      throw opError("invalid_request", "perform_action requires an element target");
    const element = this.#snapshotElement(ctx, index);
    const requested = String(params.action ?? "")
      .trim()
      .toLowerCase();
    if (requested === "") {
      throw opError(
        "action_unavailable",
        "perform_action requires an action advertised by the element; do not guess one",
      );
    }
    const advertised = (element.actions ?? []).map((action) => String(action).toLowerCase());
    if (!advertised.includes(requested)) {
      throw opError(
        "action_unavailable",
        `element ${index} does not advertise "${params.action}"; advertised: ${advertised.join(", ") || "none"}.`,
      );
    }
    const args = { pid: ctx.app.pid, element_token: this.#tokenFor(ctx, index) };
    if (requested === "expand") args.action = "expand";
    else if (!["invoke", "select", "click", "press"].includes(requested)) {
      throw opError(
        "action_unavailable",
        `action "${params.action}" is not supported on Windows in this build.`,
      );
    }
    await this.#driverTool("click", args, { mutating: true });
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  async paste(params = {}) {
    const ctx = await this.#actionContext(params.app_ref);
    if (typeof params.text !== "string") throw opError("invalid_request", "paste requires text");
    let previousText;
    try {
      const read = await this.#driverTool("clipboard_read", {});
      previousText = typeof read?.text === "string" ? read.text : undefined;
    } catch {
      previousText = undefined;
    }
    await this.#driverTool("clipboard_write", { text: params.text }, { mutating: true });
    try {
      // Ctrl+V 经统一按键原语（press_key+modifiers+foreground）：hotkey 在 XAML 目标上会被
      // 加速键匹配分支拒绝；press_key 的 SendInput 路径在经典/XAML 目标上都实测正确
      // （2026-10-06；此前 background hotkey 丢 Ctrl，只打进裸 "v" 还返回成功）。
      await this.#pressKey(ctx, "v", ["ctrl"]);
    } finally {
      if (typeof previousText === "string") {
        try {
          await this.#driverTool("clipboard_write", { text: previousText }, { mutating: true });
        } catch {
          // 剪贴板恢复是尽力而为，不覆盖主操作结果。
        }
      }
    }
    return await this.#actionReceipt(ctx, params, ctx.snapshot?.digest, {});
  }

  async request_access() {
    let report;
    try {
      report = await this.#driverTool("check_permissions", {});
    } catch (error) {
      report = { error: error instanceof Error ? error.message : String(error) };
    }
    const payload = {
      ready: report?.error === undefined,
      platform: "win32",
      driver: clip(JSON.stringify(report ?? {}), 400),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }

  async stop_computer_control(params = {}) {
    this.#snapshots.clear();
    this.#latestWindowByPid.clear();
    this.#latestFrame = null;
    this.#pendingEffects.clear();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            stopped: true,
            ...(typeof params.reason === "string" && params.reason.trim() !== ""
              ? { reason: params.reason.trim() }
              : {}),
          }),
        },
      ],
    };
  }
}

function toApp(app) {
  return {
    pid: app.pid,
    name: app.name ?? null,
    bundle_id: app.bundle_id ?? null,
    launch_path: app.launch_path ?? null,
    active: app.active === true,
    // kind（desktop/uwp）决定按键投递策略（见 #pressKey）：UWP 的 background 输入会被吞。
    ...(typeof app.kind === "string" ? { kind: app.kind } : {}),
  };
}

function deriveAumid(app) {
  if (typeof app.bundle_id === "string" && app.bundle_id.includes("!")) return app.bundle_id;
  if (
    typeof app.launch_path === "string" &&
    app.launch_path.toLowerCase().startsWith("shell:appsfolder\\")
  ) {
    return app.launch_path.slice("shell:appsFolder\\".length);
  }
  if (app.kind === "uwp" && typeof app.bundle_id === "string" && app.bundle_id !== "") {
    return `${app.bundle_id}!App`;
  }
  return undefined;
}
