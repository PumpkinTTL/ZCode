// 启发式扫描：实例/模块级 Map/Set 容器「有写无删」的可疑点。
//
// 只做粗筛：对每个 `xxx = new Map/Set` 声明，统计该变量在本文件里的
// .set(/.add( 与 .delete(/.clear( 出现次数；有写无删就列出，供人工判断。
// 注意：容器可能由别的文件清理、或靠 size 上限淘汰、或生命周期与宿主同长
// （有界但无显式删除），所以输出是**候选清单**而非结论。
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync(
  'git ls-files "packages/services/src/**/*.ts" "packages/desktop/src/**/*.ts" "packages/desktop/src/**/*.tsx" "packages/ui/src/**/*.ts" "packages/ui/src/**/*.tsx" "packages/shared/src/**/*.ts"',
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const DECL_RE = /(?:^|(?<=\n))(?:export\s+)?(?:private\s+(?:readonly\s+)?|const\s+|let\s+)([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*new (?:Map|Set|WeakMap)\s*[<(]/g;

const flagged = [];
for (const file of files) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  DECL_RE.lastIndex = 0;
  let match;
  while ((match = DECL_RE.exec(source)) !== null) {
    const name = match[1];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sets = (source.match(new RegExp(`\\b${escaped}\\.(set|add)\\(`, "g")) ?? []).length;
    const dels = (source.match(new RegExp(`\\b${escaped}\\.(delete|clear)\\(`, "g")) ?? []).length;
    const capCheck = new RegExp(`${escaped}\\.size\\s*[><=]`, "g").test(source);
    if (sets > 0 && dels === 0 && !capCheck) {
      flagged.push(`${file}  ::  ${name}  sets=${sets} deletes=0`);
    }
  }
}

console.log(`候选（有写、本文件无删、无 size 上限判断）：${flagged.length}`);
for (const item of flagged) {
  console.log(`  ${item}`);
}
