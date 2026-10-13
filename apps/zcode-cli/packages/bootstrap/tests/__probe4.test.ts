import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

describe("probe4", () => {
  it("inspect runtime config identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "probe4-"));
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    try {
      const app = await createRegistryBackedTestApp({
        env: {},
        runtimeConfig: { workingDirectory: root },
        sessionStore: store,
        skipUserConfig: true,
      });
      const runtime = app.runtime as unknown as { config: Record<string, unknown> };
      console.log("PROBE4 memory:", JSON.stringify(runtime.config.memory ?? null));
      console.log(
        "PROBE4 subagentProfiles len:",
        Array.isArray((runtime.config.subagents as { profiles?: unknown[] } | undefined)?.profiles)
          ? ((runtime.config.subagents as { profiles: unknown[] }).profiles as unknown[]).length
          : "none",
      );
      console.log("PROBE4 selection before:", JSON.stringify(runtime.config.bashShellSelection ?? null));
      await app.runtime.executeTurn("hi");
      console.log("PROBE4 selection after:", JSON.stringify(runtime.config.bashShellSelection ?? null));
      await app.close?.();
      expect(true).toBe(true);
    } finally {
      store.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
