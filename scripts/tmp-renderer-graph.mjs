// 临时分析脚本：从 renderer main.tsx 出发的静态 import 图（符号级桶解析）。
// 产出：重库是否进入首屏静态图、动态 import 边界、重库 import 站点清单。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO = "D:/DevelopmentProject/ZCode-fork";
const UI_SRC = join(REPO, "packages/ui/src");

const HEAVY = {
  "@xterm/xterm": "xterm",
  "@xterm/addon-fit": "xterm-addon-fit",
  "@xterm/addon-clipboard": "xterm-addon-clipboard",
  "@xyflow/react": "xyflow",
  lexical: "lexical",
  "@lexical/react": "lexical",
  "@lexical/rich-text": "lexical",
  "@lexical/selection": "lexical",
  shiki: "shiki",
  "@pierre/diffs": "diffs",
  recharts: "recharts",
  echarts: "echarts",
  "echarts-for-react": "echarts",
  mermaid: "mermaid",
  "@streamdown/mermaid": "mermaid",
  katex: "katex",
  "@streamdown/math": "katex",
  streamdown: "streamdown",
  "@streamdown/code": "streamdown",
  "@streamdown/cjk": "streamdown",
  "pdfjs-dist": "pdfjs",
  "react-pdf": "react-pdf",
  "docx-preview": "docx-preview",
  "@extend-ai/react-docx": "react-docx",
  "@extend-ai/react-xlsx": "react-xlsx",
  "@aiden0z/pptx-renderer": "pptx-renderer",
  "media-chrome": "media-chrome",
  "@rive-app/react-webgl2": "rive",
  "@rive-app/canvas": "rive",
  motion: "motion",
  "framer-motion": "motion",
  "highlight.js": "highlight.js",
  marked: "marked",
  qrcode: "qrcode",
  "pinyin-pro": "pinyin-pro",
  "react-jsx-parser": "react-jsx-parser",
  "embla-carousel-react": "embla",
  cmdk: "cmdk",
  "lucide-react": "lucide-react",
  "world-atlas": "world-atlas",
  three: "three",
  "react-three-fiber": "three",
  "@monaco-editor/react": "monaco",
  "monaco-editor": "monaco",
  "@tanstack/react-virtual": "react-virtual",
  "react-resizable-panels": "panels",
  "@modelcontextprotocol/ext-apps": "mcp-ext-apps",
  "tokenlens": "tokenlens",
  "ansi-to-react": "ansi-to-react",
  "nanoid": "nanoid",
  zod: "zod",
};

function heavyOf(spec) {
  if (HEAVY[spec]) return HEAVY[spec];
  const parts = spec.split("/");
  const two = parts.slice(0, 2).join("/");
  if (HEAVY[two]) return HEAVY[two];
  if (spec.startsWith("@lexical/")) return "lexical";
  if (spec.startsWith("@xterm/")) return "xterm";
  if (spec.startsWith("@streamdown/")) return "streamdown";
  if (spec.startsWith("recharts/")) return "recharts";
  if (spec.startsWith("shiki/")) return "shiki";
  if (spec.startsWith("motion/")) return "motion";
  if (spec.startsWith("echarts/")) return "echarts";
  if (spec.startsWith("lucide-react/")) return "lucide-react";
  if (spec.startsWith("pdfjs-dist/")) return "pdfjs";
  if (spec.startsWith("react-pdf/")) return "react-pdf";
  if (spec.startsWith("mermaid/")) return "mermaid";
  if (spec.startsWith("katex/")) return "katex";
  if (spec.startsWith("streamdown/")) return "streamdown";
  if (spec.startsWith("@radix-ui/") || spec === "radix-ui") return "radix";
  if (spec.startsWith("d3-")) return "d3";
  return null;
}

const visited = new Map(); // file -> { staticImports: [file], dynamicImports: [file], externals: Set }
const fileCache = new Map();

function readFileCached(p) {
  if (!fileCache.has(p)) fileCache.set(p, readFileSync(p, "utf8"));
  return fileCache.get(p);
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// 解析相对/别名说明符到磁盘文件
function resolveSpec(spec, importer) {
  let base;
  if (spec.startsWith(".")) {
    base = resolve(dirname(importer), spec);
  } else if (spec.startsWith("@/")) {
    base = resolve(UI_SRC, spec.slice(2));
  } else {
    return null;
  }
  const candidates = [base];
  if (base.endsWith(".js")) {
    const stem = base.slice(0, -3);
    candidates.push(stem + ".tsx", stem + ".ts", stem + ".jsx");
  } else if (base.endsWith(".mjs")) {
    const stem = base.slice(0, -4);
    candidates.push(stem + ".mts", stem + ".ts");
  } else if (!/\.[a-z0-9]+$/i.test(base)) {
    candidates.push(base + ".tsx", base + ".ts", base + ".jsx");
  }
  candidates.push(join(base, "index.tsx"), join(base, "index.ts"), join(base, "index.js"));
  for (const c of candidates) if (isFile(c)) return c;
  return null;
}

// workspace 包 exports 映射（只处理本任务相关包）
const WS = {
  "@zcode/ui": join(UI_SRC, "index.ts"),
  "@zcode/shared": join(REPO, "packages/shared/src/index.ts"),
  "@zcode/services": join(REPO, "packages/services/src/index.ts"),
  "@zcode/client": join(REPO, "packages/client/src/index.ts"),
  "@zcode/provider": join(REPO, "packages/provider/src/index.ts"),
  "@zcode/rpc": join(REPO, "packages/rpc/src/index.ts"),
};

function resolveWorkspace(spec) {
  if (WS[spec]) return WS[spec];
  if (spec.startsWith("@zcode/ui/")) {
    const sub = spec.slice("@zcode/ui/".length);
    const cand = [join(UI_SRC, sub), join(UI_SRC, sub + ".tsx"), join(UI_SRC, sub + ".ts")];
    for (const c of cand) if (isFile(c)) return c;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
const NAMED_RE = /^\s*\{([\s\S]*?)\}/;

let typeOnlyEdges = 0;
function parseImports(src) {
  const statics = [];
  const dynamics = new Set();
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const clause = m[1];
    const spec = m[2];
    // import type {...} / import type X from —— esbuild/TS 直接擦除，不进 bundle
    if (/^\s*type\s/.test(clause) || /^\s*type\s*\{/.test(clause)) {
      typeOnlyEdges++;
      continue;
    }
    let named = null;
    const namedMatch = NAMED_RE.exec(clause);
    if (namedMatch) {
      named = namedMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("type "))
        .map((s) => s.split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
    }
    statics.push({ spec, named, clause: clause.trim().slice(0, 80) });
  }
  SIDE_EFFECT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_RE.exec(src))) statics.push({ spec: m[1], named: null, sideEffect: true });
  DYNAMIC_RE.lastIndex = 0;
  while ((m = DYNAMIC_RE.exec(src))) dynamics.add(m[1]);
  return { statics, dynamics };
}

// 桶文件符号解析：index.ts 里 symbol -> 源模块文件
function buildExportMap(barrelFile) {
  const src = readFileCached(barrelFile);
  const map = new Map();
  const starFroms = [];
  const RE = /export\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = RE.exec(src))) {
    const clause = m[1];
    const target = resolveSpec(m[2], barrelFile);
    if (!target) continue;
    if (clause.trim().startsWith("*")) {
      starFroms.push(target);
      continue;
    }
    const namedMatch = NAMED_RE.exec(clause);
    if (namedMatch) {
      for (const part of namedMatch[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) map.set(name, target);
      }
    }
  }
  const DECL_RE = /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|enum|namespace|type|interface)\s+([A-Za-z0-9_$]+)/g;
  while ((m = DECL_RE.exec(src))) map.set(m[1], barrelFile);
  if (/export\s+default/.test(src)) map.set("default", barrelFile);
  return { map, starFroms };
}

const exportMaps = new Map();
function exportMapOf(file) {
  if (!exportMaps.has(file)) exportMaps.set(file, buildExportMap(file));
  return exportMaps.get(file);
}

function resolveSymbols(file, named, depth = 0) {
  // 返回该模块中这些符号实际所在的文件集合
  if (!named || named.length === 0 || depth > 6) return [file];
  const { map, starFroms } = exportMapOf(file);
  const out = new Set();
  const unresolved = [];
  for (const name of named) {
    if (map.has(name)) out.add(map.get(name));
    else unresolved.push(name);
  }
  for (const star of starFroms) {
    const resolved = resolveSymbols(star, unresolved, depth + 1);
    for (const r of resolved) out.add(r);
  }
  if (out.size === 0) out.add(file); // 兜底
  return [...out];
}

const heavySites = new Map(); // heavyName -> [{file,line,spec,kind}]
function noteHeavy(name, file, line, spec, kind) {
  if (!heavySites.has(name)) heavySites.set(name, []);
  heavySites.get(name).push({ file, line, spec, kind });
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

const queue = [];
const edges = new Map(); // file -> { static: Set, dynamic: Set }

function enqueue(file, reason) {
  if (visited.has(file)) return;
  visited.set(file, reason);
  queue.push(file);
}

function processFile(file) {
  let src;
  try {
    src = readFileCached(file);
  } catch {
    return;
  }
  const { statics, dynamics } = parseImports(src);
  const edge = { static: new Set(), dynamic: new Set() };
  edges.set(file, edge);

  // 记录重库站点（本文件内）
  for (const st of statics) {
    const heavy = heavyOf(st.spec);
    if (heavy) {
      const idx = src.indexOf(`"${st.spec}"`);
      noteHeavy(heavy, file, idx >= 0 ? lineOf(src, idx) : 0, st.spec, "static");
    }
  }
  for (const d of dynamics) {
    const heavy = heavyOf(d);
    if (heavy) {
      const idx = src.indexOf(d);
      noteHeavy(heavy, file, idx >= 0 ? lineOf(src, idx) : 0, d, "dynamic");
    }
  }

  // 静态依赖入队
  for (const st of statics) {
    let targets = [];
    if (st.spec.startsWith(".") || st.spec.startsWith("@/")) {
      const t = resolveSpec(st.spec, file);
      if (t) targets = [t];
    } else if (st.spec.startsWith("@zcode/")) {
      const entry = resolveWorkspace(st.spec);
      if (entry) {
        const bySymbol = st.named && st.named.length > 0 ? resolveSymbols(entry, st.named) : [entry];
        targets = bySymbol;
        // 桶文件本身的 barrel 只作为符号解析器，不整体入队
      }
    } else {
      // 外部包：叶子，记录
    }
    for (const t of targets) {
      if (t === file) continue;
      const isDynamicTarget = false;
      if (![...(edges.get(file)?.static ?? [])].includes(t)) edge.static.add(t);
      enqueue(t, `static from ${file}`);
    }
  }
  for (const d of dynamics) {
    if (d.startsWith(".") ) {
      const t = resolveSpec(d, file);
      if (t) {
        edge.dynamic.add(t);
        enqueue(t, `dynamic from ${file}`);
      }
    } else if (d.startsWith("@/")) {
      const t = resolveSpec(d, file);
      if (t) {
        edge.dynamic.add(t);
        enqueue(t, `dynamic from ${file}`);
      }
    } else if (d.startsWith("@zcode/")) {
      const entry = resolveWorkspace(d);
      if (entry) {
        edge.dynamic.add(entry);
        enqueue(entry, `dynamic from ${file}`);
      }
    }
  }
}

// 起点：main.tsx
const ENTRY = join(REPO, "packages/desktop/src/renderer/src/main.tsx");
visited.set(ENTRY, "entry");
queue.push(ENTRY);
let guard = 0;
while (queue.length > 0 && guard < 60000) {
  guard++;
  const f = queue.shift();
  processFile(f);
}

console.log(`nodes=${visited.size} (guard=${guard})`);

// 报告：每个重库的静态/动态站点
console.log("\n=== 重库 import 站点（全图范围内） ===");
for (const [name, sites] of [...heavySites].sort((a, b) => b[1].length - a[1].length)) {
  const stat = sites.filter((s) => s.kind === "static");
  const dyn = sites.filter((s) => s.kind === "dynamic");
  console.log(`\n## ${name}: static=${stat.length} dynamic=${dyn.length}`);
  for (const s of stat.slice(0, 30)) {
    console.log(`  [static] ${s.file.replace(REPO, ".")}:${s.line}  (${s.spec})`);
  }
  for (const s of dyn.slice(0, 10)) {
    console.log(`  [dyn]    ${s.file.replace(REPO, ".")}:${s.line}  (${s.spec})`);
  }
}

// 从 entry 出发的纯静态可达集合（区分 dynamic 边界）
function reach(includeDynamic) {
  const seen = new Set([ENTRY]);
  const stack = [ENTRY];
  while (stack.length) {
    const f = stack.pop();
    const e = edges.get(f);
    if (!e) continue;
    const next = [...e.static, ...(includeDynamic ? e.dynamic : [])];
    for (const n of next) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}
const firstScreen = reach(false);
const all = reach(true);
console.log(`\nfirstScreen(static-only)=${firstScreen.size} all(with dynamic)=${all.size}`);

// 首屏静态图里有哪些重库站点
console.log("\n=== 首屏(纯静态)内的重库站点 ===");
for (const [name, sites] of heavySites) {
  const inFirst = sites.filter((s) => s.kind === "static" && firstScreen.has(s.file));
  if (inFirst.length === 0) continue;
  console.log(`## ${name} (${inFirst.length})`);
  for (const s of inFirst.slice(0, 8)) {
    console.log(`  ${s.file.replace(REPO, ".")}:${s.line}  (${s.spec})`);
  }
}

// 从 entry 到指定目标的最短路径（区分 static/dynamic 边）
const TARGETS = [
  "packages/ui/src/SSHDialog.tsx",
  "packages/ui/src/SettingsPage.tsx",
  "packages/ui/src/Terminal.tsx",
  "packages/ui/src/SidePaneTerminalPane.tsx",
  "packages/ui/src/terminal/TerminalSession.tsx",
  "packages/ui/src/terminal/sidePaneTerminalSessionRegistry.ts",
  "packages/ui/src/components/ui/pdf-viewer.tsx",
  "packages/ui/src/components/ai-elements/mermaid-block.tsx",
  "packages/ui/src/components/ai-elements/message.tsx",
  "packages/ui/src/components/ui/code-viewer.tsx",
  "packages/ui/src/components/ui/diff-viewer.tsx",
  "packages/ui/src/LexicalChatInput.tsx",
  "packages/ui/src/previewPaneOfficeXlsxContent.tsx",
  "packages/ui/src/previewPaneOfficeDocxContent.tsx",
  "packages/ui/src/previewPaneOfficeLegacyDocContent.tsx",
  "packages/ui/src/previewPaneOfficeContent.tsx",
  "packages/ui/src/TreemappingPane.tsx",
  "packages/ui/src/WhiteboardPane.tsx",
  "packages/ui/src/GitPane.tsx",
  "packages/ui/src/ModelTrajectoryPane.tsx",
  "packages/ui/src/command-center/CommandCenterDialog.tsx",
  "packages/ui/src/SortableWorkspaceSidebar.tsx",
  "packages/ui/src/BotsDialog.tsx",
  "packages/ui/src/business/quota/NimbusQuotaUsageChart.tsx",
  "packages/ui/src/settings/pluginSearch.ts",
  "packages/ui/src/onboarding/OnboardingDialog.tsx",
  "packages/ui/src/onboarding/OccupationOnboarding.tsx",
  "packages/ui/src/gen-ui/adapters/page.ts",
];

function shortestPath(target, staticOnly) {
  const parent = new Map();
  parent.set(ENTRY, null);
  const q = [ENTRY];
  while (q.length) {
    const f = q.shift();
    if (f === target) break;
    const e = edges.get(f);
    if (!e) continue;
    const kinds = staticOnly ? [["static", e.static]] : [["static", e.static], ["dynamic", e.dynamic]];
    for (const [kind, set] of kinds) {
      for (const n of set) {
        if (!parent.has(n)) {
          parent.set(n, { from: f, kind });
          q.push(n);
        }
      }
    }
  }
  if (!parent.has(target)) return null;
  const hops = [];
  let cur = target;
  while (cur && parent.get(cur)) {
    const { from, kind } = parent.get(cur);
    hops.unshift({ from, to: cur, kind });
    cur = from;
  }
  return hops;
}

console.log("\n=== 入口 → 重组件最短路径 ===");
for (const t of TARGETS) {
  const abs = join(REPO, t);
  const hops = shortestPath(abs, false);
  const staticHops = shortestPath(abs, true);
  if (!hops && !staticHops) {
    console.log(`\n${t}\n  (不可达)`);
    continue;
  }
  const overallLabel = !hops
    ? "不可达"
    : hops.some((h) => h.kind === "dynamic")
      ? `最短路径含 lazy(第${hops.findIndex((h) => h.kind === "dynamic") + 1}跳)`
      : "最短路径全静态";
  console.log(`\n${t}\n  静态图: ${staticHops ? "在首屏(纯静态可达)" : "不在首屏(需 lazy 边界)"}  |  ${overallLabel}`);
  if (staticHops) {
    for (const h of staticHops.slice(0, 20)) {
      console.log(`    → ${h.to.replace(REPO, ".").replace(/\\/g, "/")}`);
    }
  } else if (hops) {
    for (const h of hops.slice(0, 20)) {
      console.log(`    ${h.kind === "static" ? "→" : "⇢"} ${h.to.replace(REPO, ".").replace(/\\/g, "/")}`);
    }
  }
}
