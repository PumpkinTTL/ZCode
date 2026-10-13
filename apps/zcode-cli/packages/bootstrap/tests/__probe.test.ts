import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import {
  createRegistryBackedTestApp,
  createTestProviderRegistry,
} from "./helpers/registry-backed-test-app.js";

describe("probe", () => {
  it("probe script workflow child shell", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "probe-child-session-"));
    const workflowDir = join(tempRoot, ".zcode", "workflows");
    const shellDir = join(tempRoot, "bin");
    const scriptPath = join(workflowDir, "child-session.workflow.js");
    const zshPath = join(shellDir, "zsh");
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    await mkdir(workflowDir, { recursive: true });
    await mkdir(shellDir, { recursive: true });
    await writeFile(zshPath, "#!/bin/sh\n");
    await chmod(zshPath, 0o755);
    await writeFile(
      scriptPath,
      `
        export const meta = {
          name: "child-session",
          description: "probe",
          phases: [{ title: "Run" }],
        };
        phase("Run");
        return await agent("Say done.", {
          schema: { type: "object", properties: { done: { type: "boolean" } }, required: ["done"] },
        });
      `,
      "utf8",
    );
    const requestTexts: string[] = [];
    try {
      const app = await createRegistryBackedTestApp({
        env: { PATH: shellDir, SHELL: join(shellDir, "fish") },
        modelExecutor: {
          setModelIoFullRetentionEnabled() {},
          async generateText(request: { messages: Array<{ content: unknown }> }) {
            requestTexts.push(JSON.stringify(request.messages));
            return {
              finishReason: "stop",
              text: '```json\n{"done":true}\n```',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        } as never,
        runtimeConfig: { workingDirectory: tempRoot },
        sessionStore: store,
        skipUserConfig: true,
      });
      const result = await app.runWorkflowScript?.({ scriptPath });
      console.log("PROBE status", result?.status);
      console.log(
        "PROBE parent selection",
        JSON.stringify(app.runtime.getSessionShellSelection() ?? null),
      );
      const joined = requestTexts.join("\n");
      const shellLine = /- Shell: ([^\n\\"]+)/.exec(joined)?.[1];
      console.log("PROBE child env shell line:", shellLine);
      console.log("PROBE platform:", process.platform);
      await app.close?.();
      expect(true).toBe(true);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("probe guarded selection with bare env", async () => {
    const root = await mkdtemp(join(tmpdir(), "probe-guarded-"));
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const selection = {
      providerId: "parent",
      modelId: "model",
      options: { reasoningLevel: "high" as const },
    };
    const requests: unknown[] = [];
    const app = await createRegistryBackedTestApp({
      env: { ZCODE_HOME: root },
      skipUserConfig: true,
      sessionStore: store,
      providerRegistry: createTestProviderRegistry([selection]),
      executionPort: {
        run: async () => ({
          status: "completed" as const,
          stdout: { text: "", bytes: 0, truncated: false },
          stderr: { text: "", bytes: 0, truncated: false },
          exitCode: 0,
          durationMs: 1,
          timedOut: false,
          cancelled: false,
          startedAt: new Date(),
          completedAt: new Date(),
        }),
      },
      permissionBroker: {
        requestPermission: async (request) => {
          requests.push(request);
          return { decision: "deny" as const, reason: "probe denial" };
        },
      },
      runtimeConfig: {
        mode: "guarded",
        workingDirectory: root,
        mcp: { enabled: false },
        modelSelection: selection,
      },
      modelExecutor: {
        async generateText() {
          return {
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            text: "noop",
          };
        },
      },
    });
    try {
      const scriptPath = join(root, "guarded.workflow.js");
      await writeFile(
        scriptPath,
        'export const meta = { name: "guarded", description: "probe", phases: [{ title: "Run" }] }; phase("Run"); return await agent("Run the fixture command.");',
      );
      console.log(
        "PROBE guarded pre selection",
        JSON.stringify(app.runtime.getSessionShellSelection() ?? null),
      );
      await app.runWorkflowScript?.({ scriptPath });
      console.log(
        "PROBE guarded post selection",
        JSON.stringify(app.runtime.getSessionShellSelection() ?? null),
      );
      console.log("PROBE guarded mode", app.runtime.getMode(), "requests", requests.length);
      await app.close?.();
      expect(true).toBe(true);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
