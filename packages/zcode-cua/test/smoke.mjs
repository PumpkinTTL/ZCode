// 冒烟：直接拉起 Helper（不经宿主），走真实 broker 协议验证 health / list_apps /
// list_windows / get_app_state（含截图与帧签发）与增量观察。只读——不做任何 UI 动作。
// 运行：node packages/zcode-cua/test/smoke.mjs
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { callBrokerMethod, probeHelperHealth } from "../broker.js";

const here = dirname(fileURLToPath(import.meta.url));
const helperEntry = join(here, "..", "helper", "main.js");
const socketPath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\polaris-cua-smoke-${process.pid}-${Date.now()}`
    : `/tmp/polaris-cua-smoke-${process.pid}.sock`;

const child = spawn(process.execPath, [helperEntry, "--socket", socketPath], {
  stdio: ["ignore", "pipe", "inherit"],
});
child.stdout.on("data", (chunk) => process.stdout.write(`[helper] ${chunk}`));
child.once("exit", (code) => {
  if (code !== 0 && code !== null) console.error(`[smoke] helper exited early: ${code}`);
});

try {
  const health = await probeHelperHealth(socketPath, { timeoutMs: 15_000 });
  console.log("[smoke] health:", JSON.stringify(health));

  const apps = await callBrokerMethod({ socketPath, method: "list_apps", timeoutMs: 30_000 });
  const list = apps?.structuredContent?.apps ?? [];
  const runningApps = list.filter((app) => app.running);
  console.log(
    `[smoke] list_apps: ${list.length} entries, ${runningApps.length} running; sample:`,
    runningApps
      .slice(0, 5)
      .map((app) => `${app.name}#${app.pid}`)
      .join(", "),
  );

  const running = runningApps.find((app) => app.pid > 0);
  if (running) {
    const windows = await callBrokerMethod({
      socketPath,
      method: "list_windows",
      params: { app_ref: { pid: running.pid } },
      timeoutMs: 20_000,
    });
    const rows = windows?.structuredContent?.windows ?? [];
    console.log(
      `[smoke] list_windows(${running.name}): ${rows.length} rows; first:`,
      rows[0] ? `${rows[0].title} #${rows[0].window_id}` : "none",
    );

    const state = await callBrokerMethod({
      socketPath,
      method: "get_app_state",
      params: { app_ref: { pid: running.pid }, include_screenshot: true, disable_diffing: true },
      timeoutMs: 60_000,
    });
    const structured = state?.structuredContent ?? {};
    const image = state?.content?.find((block) => block.type === "image");
    const imageRef = state?.content?.find(
      (block) =>
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.startsWith('{"image_ref"'),
    );
    console.log(
      `[smoke] get_app_state: state_id=${structured.state_id}, elements=${structured.elements?.length}, window=${structured.window?.window_id}, image=${image ? `${image.data.length} b64` : "none"}, frame=${imageRef ? "issued" : "none"}`,
    );
    console.log(
      `[smoke] tree head:\n${String(structured.text ?? "")
        .split("\n")
        .slice(0, 8)
        .join("\n")}`,
    );

    const second = await callBrokerMethod({
      socketPath,
      method: "get_app_state",
      params: { app_ref: { pid: running.pid } },
      timeoutMs: 60_000,
    });
    console.log(
      `[smoke] diff observation: mode=${second?.structuredContent?.snapshot_mode}, base=${second?.structuredContent?.base_state_id ?? "none"}`,
    );
  }

  console.log("[smoke] OK");
} catch (error) {
  console.error("[smoke] FAILED:", error);
  process.exitCode = 1;
} finally {
  child.kill();
}
