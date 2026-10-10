// 一次性扫描：packages/ui/src 模块级副作用候选清单（供 sideEffects 白名单使用）。
// 只读分析，不改任何文件。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "packages/ui/src";
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const hits = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const reasons = [];
  // 1. CSS 副作用 import
  if (/^\s*import\s+["'][^"']+\.(css|scss|less)["']/m.test(src)) reasons.push("css-import");
  // 2. 模块顶层的全局对象写操作 / 事件注册（非常量声明行）
  const topLevelRe =
    /^(?!\s)(?:window|document|globalThis|navigator|process|HTMLElement|SVGElement|String\.prototype|Array\.prototype|Number\.prototype|Object\.prototype|Promise|EventTarget|Element)[.\[]/gm;
  if (topLevelRe.test(src)) reasons.push("global-mutation");
  // 3. 模块顶层 setInterval/addEventListener/register 调用（缩进为 0 的表达式语句）
  const callRe = /^(?:setInterval|setTimeout|addEventListener|register\w*|init\w*|install\w*|setup\w*|patch\w*|extend\w*|observe\w*|start\w*|create\w*Prototype\w*)\s*\(/gm;
  if (callRe.test(src)) reasons.push("top-level-call");
  // 4. 顶层 store/eventHub 等带 I/O 的单例创建（保守列 new XStore / makeAutoAnimate 之类）
  if (/^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:window|document|localStorage|sessionStorage|matchMedia|new BroadcastChannel|new Worker|new ResizeObserver|new MutationObserver|new IntersectionObserver)/m.test(src))
    reasons.push("io-singleton");
  if (reasons.length) hits.push({ file: relative(ROOT, f).replaceAll("\\", "/"), reasons });
}
console.log(`scanned ${files.length} files, ${hits.length} side-effect candidates:`);
for (const h of hits) console.log(`  [${h.reasons.join(",")}] ${h.file}`);
