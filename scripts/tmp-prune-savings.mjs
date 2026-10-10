// 一次性计算：按 PACKAGING_NODE_MODULES_PRUNE_PATTERNS 在当前 asar 上求和可省体积。
import { openSync, readSync, closeSync } from "node:fs";

const asarPath = process.argv[2];
const fd = openSync(asarPath, "r");
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const headerJson = Buffer.alloc(headerSize);
readSync(fd, headerJson, 0, headerSize, 16);
const header = JSON.parse(headerJson.toString("utf8"));
closeSync(fd);

const pkgPatterns = new Set(
  "echarts zrender mermaid pdfjs-dist @extend-ai @dukelib world-atlas lucide-react highlight.js katex media-chrome recharts lexical @lexical @rive-app shiki @shikijs streamdown @streamdown @xterm xterm docx-preview @aiden0z @xyflow @pierre radix-ui @radix-ui cmdk embla-carousel embla-carousel-react motion motion-dom motion-utils framer-motion us-atlas es-toolkit graphql pako qrcode pinyin-pro marked react-jsx-parser react-pdf react-resizable-panels @dnd-kit tokenlens swr zustand ansi-to-react @modelcontextprotocol zod ai @ai-sdk @babel web-streams-polyfill msw typescript @types".split(
    " ",
  ),
);
const classRe = /\/node_modules\/.*\.(d\.ts|d\.mts|d\.cts|bcmap|mdx)$/;

let total = 0;
let pkgSum = 0;
let classSum = 0;
const remainByPkg = new Map();
function walk(node, prefix) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.files) {
      walk(entry, path);
    } else if (typeof entry.size === "number") {
      total += entry.size;
      if (path.startsWith("node_modules/")) {
        const parts = path.split("/");
        if (parts.length > 1) {
          const scope = parts[0] === "node_modules" && parts[1]?.startsWith("@") ? parts[2] : parts[1];
          if (pkgPatterns.has(scope)) {
            pkgSum += entry.size;
            continue;
          }
          remainByPkg.set(scope, (remainByPkg.get(scope) ?? 0) + entry.size);
        }
        if (classRe.test("/" + path)) classSum += entry.size;
      }
    }
  }
}
walk(header, "");
console.log(`asar total       = ${(total / 1048576).toFixed(1)} MB`);
console.log(`package excludes = ${(pkgSum / 1048576).toFixed(1)} MB`);
console.log(`class excludes   = ${(classSum / 1048576).toFixed(1)} MB`);
console.log(`combined saving  = ${((pkgSum + classSum) / 1048576).toFixed(1)} MB  -> remainder ${((total - pkgSum - classSum) / 1048576).toFixed(1)} MB`);
console.log("\n=== 剩余 node_modules top 30（未在本轮排除清单内） ===");
for (const [k, v] of [...remainByPkg].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`${(v / 1048576).toFixed(1).padStart(7)} MB  ${k}`);
}
