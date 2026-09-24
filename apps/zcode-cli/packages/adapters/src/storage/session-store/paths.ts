import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { maybeThrowStorageFsFault } from "../fs-fault-injection.js";

// Polaris fork：数据根目录名。CLI 不依赖 @zcode/services，无法直接 import DATA_ROOT_DIR_NAME，
// 因此保留字面量——必须与 packages/services/src/paths.ts 的 `DATA_ROOT_DIR_NAME` 一致。
const DATA_ROOT_DIR_NAME = ".polaris";

export function getDefaultSessionDbPath(): string {
  return join(homedir(), DATA_ROOT_DIR_NAME, "cli", "db", "db.sqlite");
}

export function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    maybeThrowStorageFsFault({ operation: "mkdir", path: parent });
    mkdirSync(parent, { recursive: true });
  }
}
