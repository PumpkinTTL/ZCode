import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

describe("probe8", () => {
  it("config identity and shell propagation", async () => {
    const root = await mkdtemp(join(tmpdir(), "probe8-"));
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const outer = { workingDirectory: root } as Record<string, unknown>;
    try {
      const app = await createRegistryBackedTestApp({
        env: { PATH: root, SHELL: join(root, "fish") },
        platform: "linux",
        runtimeConfig: outer as never,
        sessionStore: store,
        skipUserConfig: true,
        modelExecutor: {
          setModelIoFullRetentionEnabled() {},
          async generateText() {
            return {
              finishReason: "stop",
              text: '```json\n{"done":true}\n```',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        } as never,
      });
      const liveConfig = (app.runtime as unknown as { config: Record<string, unknown> }).config;
      console.log("PROBE8 identity(live===outer):", liveConfig === outer);
      const scriptPath = join(root, "p.workflow.js");
      await writeFile(
        scriptPath,
        'export const meta = { name: "p", description: "p", phases: [{ title: "Run" }] }; phase("Run"); return await agent("Say done.");',
      );
      await app.runWorkflowScript?.({ scriptPath });
      console.log(
        "PROBE8 outer bashShellSelection:",
        JSON.stringify(outer.bashShellSelection ?? null),
        "outer envInfo.shell:",
        JSON.stringify((outer.envInfo as { shell?: string } | undefined)?.shell ?? null),
      );
      console.log(
        "PROBE8 live bashShellSelection:",
        JSON.stringify((liveConfig.bashShellSelection as { display?: { name?: string } } | undefined)?.display?.name ?? null),
        "live envInfo.shell:",
        JSON.stringify((liveConfig.envInfo as { shell?: string } | undefined)?.shell ?? null),
      );
      await app.close?.();
      expect(true).toBe(true);
    } finally {
      store.close();
      await rm(root, { force: true, recursive: true });
    }
  }, 60000);
});
