import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import {
  createRegistryBackedTestApp,
  createTestProviderRegistry,
} from "./helpers/registry-backed-test-app.js";

describe("probe5", () => {
  it("guarded parent turn diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "probe5-"));
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const selection = {
      providerId: "parent",
      modelId: "model",
      options: { reasoningLevel: "high" as const },
    };
    const requests: unknown[] = [];
    const modelRequests: string[] = [];
    const execute = vi.fn(async () => ({
      status: "completed" as const,
      stdout: { text: "controlled execution", bytes: 20, truncated: false },
      stderr: { text: "", bytes: 0, truncated: false },
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      startedAt: new Date(),
      completedAt: new Date(),
    }));
    let sent = false;
    const app = await createRegistryBackedTestApp({
      env: { ZCODE_HOME: root },
      skipUserConfig: true,
      sessionStore: store,
      providerRegistry: createTestProviderRegistry([selection]),
      executionPort: { run: execute },
      permissionBroker: {
        requestPermission: async (request) => {
          requests.push(request);
          return { decision: "deny" as const, reason: "guarded fixture denial" };
        },
      },
      runtimeConfig: {
        mode: "guarded",
        workingDirectory: root,
        mcp: { enabled: false },
        modelSelection: selection,
      },
      modelExecutor: {
        async generateText(request) {
          modelRequests.push(JSON.stringify(request));
          const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
          if (!sent) {
            sent = true;
            return {
              finishReason: "tool-calls",
              text: "",
              usage,
              toolCalls: [
                {
                  id: "guarded-workflow-rm",
                  name: "Bash",
                  input: { command: "rm -rf fixture-only" },
                },
              ],
            };
          }
          return {
            finishReason: "stop",
            usage,
            text: JSON.stringify({ done: true, reasoning: "controlled execution completed", verdict: "pass" }),
          };
        },
      },
    });
    try {
      const scriptPath = join(root, "guarded.workflow.js");
      await writeFile(
        scriptPath,
        'export const meta = { name: "guarded", description: "guarded test", phases: [{ title: "Run" }] }; phase("Run"); return await agent("Run the fixture command.");',
      );
      const scriptResult = await app.runWorkflowScript?.({ scriptPath });
      console.log("PROBE5 script result:", scriptResult?.status, scriptResult?.response?.slice(0, 200));
      console.log("PROBE5 after child: requests", requests.length, "execute", execute.mock.calls.length);
      console.log("PROBE5 mode", app.runtime.getMode());
      sent = false;
      const turn = await app.runtime.executeTurn("Run the fixture command in the parent.");
      console.log("PROBE5 parent turn response:", JSON.stringify(turn.response)?.slice(0, 300));
      console.log("PROBE5 parent turn keys:", JSON.stringify(Object.keys(turn as never)));
      console.log("PROBE5 after parent: requests", requests.length, "execute", execute.mock.calls.length);
      console.log("PROBE5 model request count", modelRequests.length);
      const last = modelRequests.at(-1) ?? "";
      console.log("PROBE5 last request contains Bash tool?", last.includes('"Bash"') || last.includes("Bash"));
      console.log("PROBE5 last request excerpt:", last.slice(0, 400));
      await app.close?.();
      store.close();
      expect(true).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60000);
});
