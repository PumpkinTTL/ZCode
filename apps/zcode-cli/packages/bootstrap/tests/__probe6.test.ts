import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

describe("probe6", () => {
  it("child shell with platform linux", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "probe6-"));
    const workflowDir = join(tempRoot, ".polaris", "workflows");
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
        export const meta = { name: "child-session", description: "probe", phases: [{ title: "Run" }] };
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
        platform: "linux",
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
      console.log("PROBE6 status", result?.status);
      console.log(
        "PROBE6 parent selection",
        JSON.stringify(app.runtime.getSessionShellSelection() ?? null),
      );
      const joined = requestTexts.join("\n");
      const shells = [...joined.matchAll(/- Shell: ([^\n\\"]+)/g)].map((m) => m[1]);
      console.log("PROBE6 child shell lines:", JSON.stringify(shells));
      await app.close?.();
      expect(true).toBe(true);
    } finally {
      store.close();
      await rm(tempRoot, { force: true, recursive: true });
    }
  }, 60000);
});
