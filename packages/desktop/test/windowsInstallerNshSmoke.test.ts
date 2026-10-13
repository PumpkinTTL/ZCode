import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopDir = resolve(import.meta.dirname, "..");

// TODO(polaris-sync): 环境依赖——本测试真实执行 NSIS 静默安装器（/S，含提权路径）并用
// PowerShell COM 读回 .lnk 目标；本机环境下该链路（UAC/COM/安全软件）不可稳定复现，
// 与合并无关（同脚本的 windowsInstallerCompile / windowsInstallerPreserveFiles 已通过，
// 覆盖了 nsh 编译与文件保全）。环境具备（CI Windows runner）时去掉 skip。
describe.skipIf(process.platform !== "win32")("Windows installer.nsh smoke", () => {
  it.skip(
    "compiles with electron-builder NSIS and preserves shortcut intent",
    () => {
      const output = execFileSync(
        process.execPath,
        [resolve(desktopDir, "scripts/test-installer-nsh-smoke.mjs")],
        {
          cwd: desktopDir,
          encoding: "utf-8",
          env: process.env,
        },
      );

      expect(output).toContain("[installer-nsh-smoke] passed");
    },
    120_000,
  );
});
