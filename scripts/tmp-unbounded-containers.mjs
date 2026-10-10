// 一次性扫描：模块级 new Map/Set/[] 容器清单（泄漏排查面）。
// 输出：文件、容器名、类型、所在模块是否已被 memoryDiagnostics 覆盖。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["packages/ui/src", "packages/services/src", "packages/desktop/src/main", "packages/desktop/src/host"];
const files = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) files.push(p);
  }
}
for (const r of ROOTS) walk(r);

// 已被诊断覆盖的模块（register 调用所在文件）
const monitoredModules = new Set(
  [
    "packages/ui/src/hooks/useZCodeTaskService.ts",
    "packages/ui/src/lib/shikiHighlighter.ts",
    "packages/ui/src/store/taskQueryCacheStore.ts",
    "packages/ui/src/store/zcodeSessionStore.ts",
    "packages/ui/src/terminal/sidePaneTerminalSessionRegistry.ts",
    "packages/ui/src/ToolCallBlocks/ToolLayout.tsx",
    "packages/ui/src/v4/conversationProjectionStore.ts",
  ].map((p) => p.replaceAll("/", "\\").toLowerCase()),
);

const results = [];
const re = /^(?:export\s+)?(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*(?::[^=]+)?=\s*(new Map|new Set|\[\])(\([^)]*\))?/gm;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    results.push({
      file: relative(".", f),
      name: m[1],
      kind: m[2],
      line,
      monitored: monitoredModules.has(f.toLowerCase()),
    });
  }
}
const monitored = results.filter((r) => r.monitored);
const unmonitored = results.filter((r) => !r.monitored);
console.log(`scanned ${files.length} files; containers total=${results.length}, monitored=${monitored.length}, unmonitored=${unmonitored.length}`);
console.log("\n=== 已监模块内的容器（有 provider 覆盖） ===");
for (const r of monitored) console.log(`  ${r.kind.padEnd(8)} ${r.file}:${r.line}  ${r.name}`);
console.log("\n=== 未监容器清单（候选排查面） ===");
for (const r of unmonitored) console.log(`  ${r.kind.padEnd(8)} ${r.file}:${r.line}  ${r.name}`);
