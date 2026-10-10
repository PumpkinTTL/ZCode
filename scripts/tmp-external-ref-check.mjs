// 一次性验证：main/host 产物里是否引用（external import / require）候选 node_modules 包。
// 证据口径：ESM 产物里被外置的包必然出现 import ... from "<pkg>" / import "<pkg>"；
// 没出现 = 该包被 tsup 内联或根本没人用 = asar 里的 node_modules/<pkg> 不被 main/host 需要。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = ["packages/desktop/out/main", "packages/desktop/out/host"];
const files = [];
for (const dir of OUT) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const p = join(dir, name);
    if (statSync(p).size > 40 * 1048576) continue; // 防御：跳过异常大文件
    files.push({ name, src: readFileSync(p, "utf8") });
  }
}
console.log(`scanned ${files.length} js files`);

const candidates = [
  "echarts", "zrender", "mermaid", "pdfjs-dist", "@extend-ai/react-xlsx", "@extend-ai/react-docx",
  "@dukelib/sheets-wasm", "world-atlas", "lucide-react", "highlight.js", "katex", "media-chrome",
  "recharts", "lexical", "@lexical/react", "@rive-app/canvas", "@rive-app/webgl2", "shiki",
  "@shikijs/core", "streamdown", "@streamdown/cjk", "msw", "web-streams-polyfill", "@babel/runtime",
  "@babel/standalone", "@modelcontextprotocol/client", "@modelcontextprotocol/core",
  "@modelcontextprotocol/ext-apps", "playwright-core", "zod", "ai", "@ai-sdk", "express",
  "ws", "semver", "react", "react-dom", "@modelcontextprotocol/sdk",
  // 第二梯队候选（小包，逐个确认）
  "marked", "nanoid", "qrcode", "swr", "zustand", "cmdk", "embla-carousel-react",
  "react-jsx-parser", "react-pdf", "react-resizable-panels", "docx-preview", "@aiden0z/pptx-renderer",
  "@xyflow/react", "@pierre/diffs", "tokenlens", "pinyin-pro", "ansi-to-react", "radix-ui",
  "koffi", "@zcode/tui", "node-pty", "ssh2", "undici", "yaml", "node-forge", "yauzl", "yazl",
  "electron-updater", "module-details-from-path", "node-forge",
  // 残余层候选（asar 剩余清单里的非 scoped 顶层包）
  "framer-motion", "us-atlas", "xterm", "es-toolkit", "hono", "axios", "pako", "tldts",
  "graphql", "protobufjs",
];
const importRe = (pkg) =>
  new RegExp(`(?:import|export)[^"'\\n]*?from\\s*["']${pkg.replace("/", "/")}["']|import\\s*["']${pkg.replace("/", "/")}["']|require\\s*\\(\\s*["']${pkg.replace("/", "/")}["']`);
for (const pkg of candidates) {
  const hits = [];
  const re = importRe(pkg);
  for (const f of files) {
    if (re.test(f.src)) hits.push(f.name);
  }
  console.log(`${hits.length ? "REFERENCED " : "clean      "} ${pkg}  ${hits.slice(0, 3).join(",")}`);
}
