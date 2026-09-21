import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { setDataBaseDir } from "@zcode/services/node";

/**
 * Polaris fork：数据根目录名（原 `.zcode` → `.polaris`）。
 *
 * 只改目录名，**不携带任何 `.zcode` → `.polaris` 的自动迁移**：本 fork 的数据
 * 目录要干净起步，用户自己在应用里配置。上游原有的「用户改 dataBaseDir 时搬运
 * 数据」能力（services/paths.ts 的 copyDataDirectory）与本文件无关，保持原样。
 */
const DATA_ROOT_DIR_NAME = ".polaris";

function resolveBootstrapSettingsFile(homePath: string = homedir()): string {
  return join(homePath, DATA_ROOT_DIR_NAME, "v2", "setting.json");
}

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
  }
  return dataBaseDir;
}
