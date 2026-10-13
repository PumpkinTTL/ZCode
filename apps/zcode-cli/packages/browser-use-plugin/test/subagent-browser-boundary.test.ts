import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NodeReplRequestMeta, NodeReplSession } from "@zcode/core";
import { setupBrowserRuntime } from "../src/browser-client.js";
import { createBrowserBridgeGlobals, type ActiveNodeReplCall } from "@zcode/node-repl-host/browser-bridge";
import { readNodeReplBrowserRuntimeBridge } from "@zcode/node-repl-host/runtime-bridge";

// 文档相对本文件解析：上游用 `process.cwd()/docs`，只在 cwd 恰为插件包目录时成立；
// 从 workspace 根跑 vitest 时 cwd 是 apps/zcode-cli，docs 实际在插件包内。
const BROWSER_DOCS_ROOT = fileURLToPath(new URL("../docs", import.meta.url));

describe("subagent browser boundary", () => {
  it("keeps browser bridge access and initialization available in subagent scope", async () => {
    let requestMeta: NodeReplRequestMeta = {
      runtime_scope: "main",
      session_id: "main-session",
    };
    const activeCall = (): ActiveNodeReplCall => ({
      generation: 1,
      requestMeta,
      signal: new AbortController().signal,
    });
    const globals = createBrowserBridgeGlobals({
      documentationRoot: resolve(BROWSER_DOCS_ROOT),
      generation: 1,
      getActiveCall: activeCall,
      // 本用例只走本地 documentation guard，不会执行需要 response meta 的 transport。
      session: () => undefined as unknown as NodeReplSession,
    });

    await setupBrowserRuntime({ globals });
    const documentation = (
      globals.agent as { documentation: { get(name: string): Promise<string> } }
    ).documentation;
    await expect(documentation.get("overview")).resolves.toContain("Browser");
    const bridge = readNodeReplBrowserRuntimeBridge(globals);

    requestMeta = { runtime_scope: "subagent", session_id: "subagent-session" };
    expect(() => bridge.assertAvailable()).not.toThrow();
    await expect(setupBrowserRuntime({ globals })).resolves.toBeUndefined();
    await expect(documentation.get("overview")).resolves.toContain("Browser");
  });
});
