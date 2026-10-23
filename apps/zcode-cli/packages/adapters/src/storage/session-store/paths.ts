import { homedir } from "node:os";
import { join } from "node:path";

// Polaris fork：数据根目录名。CLI 不依赖 @zcode/services，无法直接 import DATA_ROOT_DIR_NAME，
// 因此保留字面量——必须与 packages/services/src/paths.ts 的 `DATA_ROOT_DIR_NAME` 一致。
const DATA_ROOT_DIR_NAME = ".polaris";

export function getDefaultSessionDbPath(): string {
  return join(homedir(), DATA_ROOT_DIR_NAME, "cli", "db", "db.sqlite");
}
