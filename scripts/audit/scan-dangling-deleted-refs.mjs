// 精确扫描「已被删除模块」的悬空引用：只解析 import / require / 动态 import 的**说明符**，
// 解析成绝对路径后与删除集合比对。按 basename 全文匹配会产生大量误报（claude、opencode 这类通用名）。
//
// 为什么要它：批量死代码清理删掉 src 模块后，若有文件仍 import 它，vitest 会在收集阶段整文件报
// "Cannot find package"（Failed Suites），而 typecheck 抓不到——根 tsconfig 的 include 只覆盖 src，
// 不含 test 与 apps/*/tests。
//
// 用法：node scripts/audit/scan-dangling-deleted-refs.mjs <删除提交> [--verbose]
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const commit = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!commit) {
  console.error("用法: node scripts/audit/scan-dangling-deleted-refs.mjs <删除提交> [--verbose]");
  process.exit(1);
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const root = process.cwd();

const deleted = execSync(`git show --diff-filter=D --name-only ${commit}`, { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && CODE_EXT.test(line));
// 说明符解析后扩展名已被剥掉（`@/lib/foo.js` → `.../lib/foo`），所以删除集合也要同时存
// 「带扩展名」与「不带扩展名」两种形态，否则永远比不中。
const deletedAbs = new Set(
  deleted.map((p) => path.resolve(root, p).replace(/\\/g, "/").toLowerCase()),
);
const deletedAbsNoExt = new Set(
  deleted.map((p) => {
    const abs = path.resolve(root, p).replace(/\\/g, "/").toLowerCase();
    return abs.replace(CODE_EXT, "");
  }),
);

// 仓库级别名（根 vitest.config.ts）：@ -> packages/ui/src，@desktop -> packages/desktop/src，
// @web -> packages/web/src。apps/zcode-cli 各包另有自己的别名，这里只解析相对与上述三种。
const ALIASES = [
  ["@desktop/", "packages/desktop/src/"],
  ["@web/", "packages/web/src/"],
  ["@/", "packages/ui/src/"],
];

const tracked = execSync('git ls-files "*.ts" "*.tsx" "*.js" "*.jsx" "*.mjs" "*.cjs"', {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.includes("node_modules"));

// package.json exports / 条件导出入口（动态入口）会被静态解析误判，单独列出以便人工复核。
const SPECIFIER_RE = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

function candidatePaths(absNoExt) {
  return [
    `${absNoExt}.ts`,
    `${absNoExt}.tsx`,
    `${absNoExt}.js`,
    `${absNoExt}.jsx`,
    `${absNoExt}.mjs`,
    path.join(absNoExt, "index.ts"),
    path.join(absNoExt, "index.tsx"),
    path.join(absNoExt, "index.js"),
  ].map((p) => path.resolve(p).replace(/\\/g, "/").toLowerCase());
}

const hits = [];
const unresolved = [];
for (const file of tracked) {
  let source;
  try {
    source = readFileSync(path.join(root, file), "utf8");
  } catch {
    continue;
  }
  const dir = path.dirname(path.resolve(root, file));
  SPECIFIER_RE.lastIndex = 0;
  let match;
  while ((match = SPECIFIER_RE.exec(source)) !== null) {
    const spec = match[1];
    let base = null;
    if (spec.startsWith(".")) {
      base = path.resolve(dir, spec.replace(CODE_EXT, ""));
    } else {
      for (const [alias, target] of ALIASES) {
        if (spec.startsWith(alias)) {
          base = path.resolve(root, target, spec.slice(alias.length).replace(CODE_EXT, ""));
          break;
        }
      }
    }
    if (!base) {
      continue;
    }
    const normalized = base.replace(/\\/g, "/").toLowerCase();
    // 命中删除集合，或解析目标已不存在（既不在磁盘、也不在 git 索引里）
    if (deletedAbs.has(normalized) || deletedAbsNoExt.has(normalized.replace(CODE_EXT, ""))) {
      hits.push(`${file}  ->  ${spec}  [已删除]`);
    } else if (!candidatePaths(normalized).some((c) => existsSync(c))) {
      unresolved.push(`${file}  ->  ${spec}`);
    }
  }
}

console.log(`删除提交 ${commit}：${deleted.length} 个代码文件`);
console.log(`\n确认命中已删除模块的引用：${hits.length}`);
for (const hit of hits) {
  console.log(`  ${hit}`);
}
console.log(
  `\n解析不到文件的引用（含 package exports 动态入口、CLI 内部别名等，需人工判断）：${unresolved.length}`,
);
if (verbose) {
  for (const item of unresolved) {
    console.log(`  ${item}`);
  }
} else {
  console.log("  （加 --verbose 查看全部）");
}
