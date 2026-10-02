#!/usr/bin/env node
// 孤儿源文件扫描器（保守版）。
//
// 目标：找出「没有任何代码 import/require 到」的源文件。
// 刻意保守——只把「代码图里入度为 0 且无字符串引用」的文件列为疑似孤儿，
// 真正的删除仍需人工复核。
//
// 方法：
//   1. 用 git ls-files 取全部源码文件（.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs）。
//   2. 候选集 = 源文件里排除 .d.ts、node_modules/out/dist/build/coverage。
//      测试文件本身不算候选（不删），但可作为「引用方」。
//   3. 用 TypeScript 的 preProcessFile 抽取每个文件的所有 import/require/动态 import
//      说明符，并把说明符解析回真实文件路径（@/ alias、@zcode/* workspace exports、
//      相对路径、index.ts 省略、.js→.ts 扩展名重写）。
//   4. 入口/配置/package.json(exports|bin|main)/测试 引用的文件一律计为「被引用」。
//   5. 对仍为 0 入度的文件，再做一次全仓字符串回扫（basename / 相对路径），
//      命中即标记 stringRef，绝不自动删除。
//
// 用法：
//   node scripts/find-orphans.mjs            # 人类可读报告
//   node scripts/find-orphans.mjs --json     # JSON（供程序处理）

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes("--json");

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const DECL_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts"];
const IGNORE_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|e2e)(\/|$)|\.(test|spec|e2e)\./;

// 入口 / 引导文件：一律视为被引用。
const ENTRY_RE = [
  /(^|\/)index\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/,
  /(^|\/)main\.(ts|tsx|js|mjs|cjs)$/,
  /(^|\/)bootstrap\.(ts|tsx|js|mjs|cjs)$/,
  /(^|\/)entry[^/]*\.(ts|tsx|js|mjs|cjs)$/,
  /(^|\/)(preload|renderer)\//,
  /(^|\/)bin\//,
];

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function rel(abs) {
  return toPosix(path.relative(ROOT, abs));
}

function isCodeFile(p) {
  return CODE_EXTENSIONS.some((e) => p.endsWith(e));
}

function isDecl(p) {
  return DECL_EXTENSIONS.some((e) => p.endsWith(e));
}

const tracked = sh("git", ["ls-files"]).split("\n").filter(Boolean);

// 全部可作为解析目标的文件（含 .d.ts / 配置 / 脚本 / 测试）。
const targetFiles = new Set();
for (const f of tracked) {
  if (IGNORE_DIRS.has(f.split("/")[0]) && f.split("/")[0] !== "packages") continue;
  if (f.split("/").some((s) => IGNORE_DIRS.has(s))) continue;
  if (!isCodeFile(f)) continue;
  targetFiles.add(path.normalize(path.resolve(ROOT, f)));
}
// 也纳入未跟踪的 .mjs 脚本？不——只处理 git 跟踪文件，避免噪声。

// 候选集：可能被删的孤儿（源文件，排除声明/测试）。
const candidates = new Set();
for (const f of tracked) {
  if (f.split("/").some((s) => IGNORE_DIRS.has(s))) continue;
  if (!isCodeFile(f)) continue;
  if (isDecl(f)) continue;
  if (TEST_PATH_RE.test(f)) continue;
  candidates.add(path.normalize(path.resolve(ROOT, f)));
}

// 引用方：所有代码文件（含测试、声明、脚本）都可能 import。
const referrers = [];
for (const f of tracked) {
  if (f.split("/").some((s) => IGNORE_DIRS.has(s))) continue;
  if (!isCodeFile(f)) continue;
  referrers.push(path.normalize(path.resolve(ROOT, f)));
}

// ---- workspace 包信息（用于 @zcode/* 与 @/ 解析） ----
function listWorkspacePackages() {
  const roots = [];
  for (const f of tracked) {
    if (!f.endsWith("package.json")) continue;
    if (f.split("/").some((s) => IGNORE_DIRS.has(s))) continue;
    roots.push(f);
  }
  const pkgs = [];
  for (const f of roots) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    } catch {
      continue;
    }
    if (!json.name) continue;
    const root = path.dirname(path.resolve(ROOT, f));
    pkgs.push({
      name: json.name,
      root,
      srcRoot: path.join(root, "src"),
      exports: json.exports ?? {},
      imports: json.imports ?? {},
      main: json.main,
    });
  }
  return pkgs;
}
const workspacePackages = listWorkspacePackages();

// 取「最具体」的归属包（root 最长者优先），否则仓库根 package.json 会吞掉所有文件。
const workspacePackagesBySpecificity = [...workspacePackages].sort(
  (a, b) => b.root.length - a.root.length,
);

function findOwningPackage(abs) {
  return (
    workspacePackagesBySpecificity.find(
      (p) => p.root !== ROOT && (abs === p.root || abs.startsWith(`${p.root}${path.sep}`)),
    ) ?? null
  );
}

function fileCandidates(basePath) {
  const b = toPosix(basePath);
  const ext = CODE_EXTENSIONS.find((e) => b.endsWith(e));
  if (ext) {
    const stem = b.slice(0, -ext.length);
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      return [b, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.d.ts`];
    }
    return [b];
  }
  const out = [];
  for (const e of CODE_EXTENSIONS) out.push(`${b}${e}`);
  out.push(`${b}.d.ts`);
  for (const e of CODE_EXTENSIONS) out.push(`${b}/index${e}`);
  out.push(`${b}/index.d.ts`);
  return out;
}

function findExistingFile(basePath) {
  for (const c of fileCandidates(basePath)) {
    const n = path.normalize(c);
    if (targetFiles.has(n)) return n;
  }
  return null;
}

function extractStringExportTarget(v) {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return null;
  for (const nested of Object.values(v)) {
    const t = extractStringExportTarget(nested);
    if (t) return t;
  }
  return null;
}

function resolveSpecifier(spec, sourceFile) {
  if (spec.startsWith("node:") || spec.startsWith("data:")) return null;
  const sp = findOwningPackage(sourceFile);

  if (spec.startsWith("./") || spec.startsWith("../")) {
    return findExistingFile(path.resolve(path.dirname(sourceFile), spec));
  }
  // @/ alias：各包 tsconfig paths（ui 定义为 ./src/*）
  if (spec.startsWith("@/") && sp) {
    return findExistingFile(path.join(sp.srcRoot, spec.slice(2)));
  }
  // Node.js subpath imports（如 packages/services 的 "#src/*": "./src/*"）
  if (spec.startsWith("#") && sp && sp.imports) {
    for (const [key, target] of Object.entries(sp.imports)) {
      const mapped = extractStringExportTarget(target);
      if (!mapped) continue;
      if (key.endsWith("*")) {
        const prefix = key.slice(0, -1);
        if (!spec.startsWith(prefix)) continue;
        const rest = spec.slice(prefix.length);
        const base = mapped.includes("*") ? mapped.replace("*", rest) : path.join(mapped, rest);
        const r = findExistingFile(path.join(sp.root, base));
        if (r) return r;
      } else if (key === spec) {
        const r = findExistingFile(path.join(sp.root, mapped));
        if (r) return r;
      }
    }
    return null;
  }
  if (!spec.startsWith("@zcode/")) return null;

  const segs = spec.split("/");
  const pkgName = segs.slice(0, 2).join("/");
  const sub = segs.slice(2).join("/");
  const target = workspacePackages.find((p) => p.name === pkgName);
  if (!target) return null;

  if (sub) {
    const exported = extractStringExportTarget(target.exports?.[`./${sub}`]);
    if (exported) {
      const r = findExistingFile(path.join(target.root, exported));
      if (r) return r;
    }
    return findExistingFile(path.join(target.srcRoot, sub));
  }
  const rootExport = extractStringExportTarget(target.exports?.["."]);
  if (rootExport) {
    const r = findExistingFile(path.join(target.root, rootExport));
    if (r) return r;
  }
  return findExistingFile(path.join(target.srcRoot, "index"));
}

// ---- package.json exports/bin/main 声明的入口文件 ----
const pkgDeclared = new Set();
for (const p of workspacePackages) {
  const strings = [];
  const collect = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) collect(x);
  };
  collect(p.exports);
  collect(p.main);
  collect(p.bin);
  for (const s of strings) {
    if (typeof s !== "string" || !isCodeFile(s)) continue;
    const abs = path.normalize(path.resolve(p.root, s));
    if (targetFiles.has(abs)) pkgDeclared.add(abs);
  }
}

// ---- 计算入度 ----
const inDegree = new Map();
const reasons = new Map();
for (const f of referrers) {
  let text;
  try {
    text = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const info = ts.preProcessFile(text, true, true);
  const specs = new Set(
    [
      ...info.importedFiles.map((i) => i.fileName),
      ...info.referencedFiles.map((i) => i.fileName),
    ].filter(Boolean),
  );
  for (const spec of specs) {
    const resolved = resolveSpecifier(spec, f);
    if (!resolved || resolved === f) continue;
    inDegree.set(resolved, (inDegree.get(resolved) ?? 0) + 1);
    if (!reasons.has(resolved)) reasons.set(resolved, []);
    reasons.get(resolved).push(rel(f));
  }
}

// 入口/声明入口计入被引用
for (const c of candidates) {
  const r = rel(c);
  if (ENTRY_RE.some((rx) => rx.test(r)) || pkgDeclared.has(c) || TEST_PATH_RE.test(r)) {
    inDegree.set(c, (inDegree.get(c) ?? 0) + 1);
    if (!reasons.has(c)) reasons.set(c, []);
    reasons.get(c).push("<entry/config>");
  }
}

// ---- 字符串引用回扫（针对 0 入度候选）----
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 一次性把全部可读文本读入内存，避免 O(orphans × files) 的重复磁盘 IO。
const textCache = new Map();
for (const f of tracked) {
  if (f.split("/").some((s) => IGNORE_DIRS.has(s))) continue;
  const absF = path.normalize(path.resolve(ROOT, f));
  try {
    textCache.set(absF, fs.readFileSync(absF, "utf8"));
  } catch {
    // 二进制/缺失文件跳过
  }
}

function stringRefsFor(abs) {
  const relPath = rel(abs);
  const base = path.basename(abs);
  const baseNoExt = base.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
  const baseRe = new RegExp(`(^|[/"'\`])${escapeRe(base)}(["'\`]|$)`);
  const hits = [];
  for (const [absF, text] of textCache) {
    if (absF === abs) continue;
    // 故意宽松：命中 basename 子串就算字符串引用，宁可多保留不可误删。
    if (text.includes(base) || text.includes(relPath) || baseRe.test(text)) {
      hits.push(rel(absF));
    } else if (baseNoExt.length > 4 && text.includes(baseNoExt)) {
      hits.push(rel(absF));
    }
  }
  return hits;
}

if (process.env.DEBUG_ORPHAN) {
  const probe = path.normalize(path.resolve(ROOT, process.env.DEBUG_ORPHAN));
  console.error("probe=", probe);
  console.error("isCandidate=", candidates.has(probe), "inDegree=", inDegree.get(probe));
  console.error("reasons=", (reasons.get(probe) ?? []).slice(0, 5));
  const owner = findOwningPackage(probe);
  console.error("owner=", owner?.name, owner?.srcRoot);
  console.error(
    "resolved @/WorkspaceHeader.js =>",
    resolveSpecifier(
      "@/WorkspaceHeader.js",
      path.join(ROOT, "packages/ui/src/app-shell/WorkspaceShellLayout.tsx"),
    ),
  );
}

// ---- 汇总 ----
const orphans = [];
for (const c of candidates) {
  if ((inDegree.get(c) ?? 0) > 0) continue;
  const refs = stringRefsFor(c);
  orphans.push({ file: rel(c), stringRefs: refs });
}
orphans.sort((a, b) => a.file.localeCompare(b.file));

if (JSON_OUT) {
  process.stdout.write(
    JSON.stringify(
      {
        counts: {
          candidates: candidates.size,
          referrers: referrers.length,
          orphans: orphans.length,
        },
        orphans,
      },
      null,
      2,
    ) + "\n",
  );
} else {
  console.log(
    `candidates=${candidates.size} referrers=${referrers.length} suspected-orphans=${orphans.length}\n`,
  );
  for (const o of orphans) {
    console.log(
      o.stringRefs.length === 0
        ? `[NO-CODE-NO-STRING] ${o.file}`
        : `[NO-CODE stringRef=${o.stringRefs.length}] ${o.file}`,
    );
    for (const s of o.stringRefs.slice(0, 4)) console.log(`      ~ ${s}`);
  }
}
