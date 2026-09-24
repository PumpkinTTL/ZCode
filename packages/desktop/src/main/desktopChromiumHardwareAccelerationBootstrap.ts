import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ChromiumHardwareAccelerationApp {
  disableHardwareAcceleration(): void;
}

// Polaris fork：数据根目录名必须与 packages/services/src/paths.ts 的 DATA_ROOT_DIR_NAME 一致。
// 本文件在 Electron app ready 之前就被加载，为避免为此拉入 @zcode/services/node 依赖图，这里保留字面量。
const DATA_ROOT_DIR_NAME = ".polaris";

function resolveChromiumHardwareAccelerationSettingsFile(homePath: string = homedir()): string {
  return join(homePath, DATA_ROOT_DIR_NAME, "v2", "setting.json");
}

function extractBootstrapChromiumHardwareAccelerationEnabled(rawValue: unknown): boolean {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return true;
  }

  const enabled = (
    rawValue as {
      desktopChromiumHardwareAccelerationEnabled?: unknown;
    }
  ).desktopChromiumHardwareAccelerationEnabled;
  return typeof enabled === "boolean" ? enabled : true;
}

function readBootstrapChromiumHardwareAccelerationEnabledFromDisk(
  settingsFile: string = resolveChromiumHardwareAccelerationSettingsFile(),
): boolean {
  if (!existsSync(settingsFile)) {
    return true;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapChromiumHardwareAccelerationEnabled(JSON.parse(raw));
  } catch {
    return true;
  }
}

export function applyEarlyChromiumHardwareAccelerationBootstrap(
  app: ChromiumHardwareAccelerationApp,
  rawSettings?: unknown,
): boolean {
  const enabled =
    rawSettings === undefined
      ? readBootstrapChromiumHardwareAccelerationEnabledFromDisk()
      : extractBootstrapChromiumHardwareAccelerationEnabled(rawSettings);
  if (!enabled) {
    // Electron 只能在 app ready 前关闭 Chromium 硬件加速。
    // 因此设置页保存后必须在下一次 main 进程最早期读取并应用，不能等到 whenReady。
    app.disableHardwareAcceleration();
  }
  return enabled;
}
