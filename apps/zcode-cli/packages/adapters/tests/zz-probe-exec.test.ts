import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCwdCapturePlan, readCapturedCwd } from "../src/exec/cwd-capture.js";
import { resolveExecutionCommand } from "../src/exec/execution-command.js";

describe("probe cmd capture", () => {
  it("inspects plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-probe-cmdcap-"));
    const child = join(root, "child");
    await mkdir(child);
    const request = {
      command: { mode: "shell" as const, command: `cd /d "${child}"` },
      cwd: root,
      captureCwdAfterSuccess: true,
    };
    const plan = createCwdCapturePlan(request as never, { dialect: "cmd", platform: "win32" });
    console.log("PROBE-PLAN", JSON.stringify(plan.command.command));
    console.log("PROBE-FILE", JSON.stringify(plan.cwdFilePath));
    const resolved = resolveExecutionCommand(plan.command, { cwd: root, platform: "win32" });
    console.log("PROBE-RESOLVED", JSON.stringify(resolved));
    const direct = readCapturedCwd(plan.cwdFilePath, { dialect: "cmd" });
    console.log("PROBE-DIRECT", JSON.stringify(direct));
    if (plan.cwdFilePath) {
      try { console.log("PROBE-CONTENT", JSON.stringify(await readFile(plan.cwdFilePath, "utf8"))); } catch (e) { console.log("PROBE-READERR", String(e).slice(0,100)); }
    }
    await rm(root, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
