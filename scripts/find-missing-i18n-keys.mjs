// 临时扫描器：① 代码里引用、但 en-US 缺失的 i18n id（raw-id 渲染风险）；② en/zh 键集合差集。
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "dist-types", "build", ".e2e-cache"].includes(entry.name))
      continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const localesDir = join(root, "packages/ui/src/i18n/locales");
const keysOf = (s) => new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
const enKeys = keysOf(await readFile(join(localesDir, "en-US.ts"), "utf8"));
const zhKeys = keysOf(await readFile(join(localesDir, "zh-CN.ts"), "utf8"));

const files = await walk(join(root, "packages"));
const used = new Map();
for (const f of files) {
  const rel = f.replaceAll("\\", "/");
  if (rel.includes("/i18n/locales/")) continue;
  const txt = await readFile(f, "utf8");
  for (const m of txt.matchAll(/\bid:\s*"([^"]+)"/g)) {
    const id = m[1];
    if (!id.includes(".")) continue; // i18n keys are dotted; skip DOM/other ids
    if (!used.has(id)) used.set(id, rel);
  }
}

const missingInEn = [...used].filter(([id]) => !enKeys.has(id));
const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k));
const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k));

console.log(`referenced dotted ids: ${used.size}`);
console.log(`missing in en-US (${missingInEn.length}):`);
for (const [id, file] of missingInEn.sort()) console.log(`  ${id}  <- ${file}`);
console.log(`only in en-US (${onlyEn.length}): ${onlyEn.slice(0, 40).join(", ")}`);
console.log(`only in zh-CN (${onlyZh.length}): ${onlyZh.slice(0, 40).join(", ")}`);
