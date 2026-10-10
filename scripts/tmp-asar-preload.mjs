// 临时脚本：实测 asar 内 renderer 首屏（modulepreload）与 lazy chunk 的体积分布。
// 内存纪律：定点 readSync 读取所需范围，不整读 asar。
import { openSync, readSync, closeSync } from "node:fs";

const asarPath = process.argv[2];
const fd = openSync(asarPath, "r");

let headerSize;
{
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  headerSize = head.readUInt32LE(12);
}
const headerJson = Buffer.alloc(headerSize);
readSync(fd, headerJson, 0, headerSize, 16);
const header = JSON.parse(headerJson.toString("utf8"));
const dataStart = 16 + headerSize;

function nodeAt(p) {
  const parts = p.split("/").filter(Boolean);
  let node = header;
  for (const part of parts) {
    if (!node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}
function readRange(node) {
  const offset = dataStart + Number(node.offset ?? 0);
  const buf = Buffer.alloc(node.size);
  readSync(fd, buf, 0, node.size, offset);
  return buf.toString("utf8");
}

const assetsDir = nodeAt("out/renderer/assets");
const sizes = new Map();
for (const [name, entry] of Object.entries(assetsDir.files)) {
  sizes.set(`./assets/${name}`, entry.size);
}

const html = readRange(nodeAt("out/renderer/index.html"));
const preloads = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const entryMatch = html.match(/src="([^"]+)"/);
const entry = entryMatch ? entryMatch[1] : null;

let firstSum = 0;
const missing = [];
for (const p of new Set(preloads)) {
  if (!sizes.has(p)) missing.push(p);
  else firstSum += sizes.get(p);
}
if (entry && sizes.has(entry)) firstSum += sizes.get(entry);

const totalAssets = [...sizes.values()].reduce((a, b) => a + b, 0);
const lazy = [...sizes.entries()].filter(([p]) => !preloads.includes(p) && p !== entry);

console.log(`preload 链接数=${new Set(preloads).size} missing=${missing.length}`);
console.log(`首屏（entry+preload）合计 = ${(firstSum / 1048576).toFixed(2)} MB`);
console.log(`assets 总计 = ${(totalAssets / 1048576).toFixed(2)} MB  文件数=${sizes.size}`);
console.log(`非首屏(lazy/资源) = ${(lazy.reduce((a, [, s]) => a + s, 0) / 1048576).toFixed(2)} MB  文件数=${lazy.length}`);
console.log(`entry = ${entry}  (${(sizes.get(entry) / 1048576).toFixed(2)} MB)`);
if (missing.length) console.log(`missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`);

console.log("\n=== 首屏 preload 里 top 25 大 chunk ===");
for (const [p, s] of [...new Set(preloads)]
  .map((p) => [p, sizes.get(p) ?? 0])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)) {
  console.log(`${(s / 1024).toFixed(0).padStart(8)} KB  ${p}`);
}

console.log("\n=== 非首屏 top 25 大 chunk ===");
for (const [p, s] of lazy.sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`${(s / 1024).toFixed(0).padStart(8)} KB  ${p}`);
}

const heavy = ["katex", "chart", "mermaid", "shiki", "xterm", "lexical", "pdf", "docx", "xlsx", "pptx", "rive", "motion", "three"];
console.log("\n=== 首屏内疑似重库 chunk（按名匹配） ===");
let heavySum = 0;
for (const [p] of [...new Set(preloads)].map((p) => [p, sizes.get(p) ?? 0]).sort((a, b) => b[1] - a[1])) {
  const name = p.toLowerCase();
  if (heavy.some((h) => name.includes(h))) {
    const s = sizes.get(p) ?? 0;
    heavySum += s;
    console.log(`${(s / 1024).toFixed(0).padStart(8)} KB  ${p}`);
  }
}
console.log(`首屏疑似重库合计 = ${(heavySum / 1048576).toFixed(2)} MB`);
closeSync(fd);
