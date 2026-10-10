// 一次性分析：检查 styles chunk 中的超大内嵌字符串与库标记上下文。
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync(join(tmpdir(), "styles-chunk.js"), "utf8");
console.log("total chars", src.length);

// 按引号切分找超长段（内嵌数据特征）
const parts = src.split('"');
let longest = [];
for (let i = 1; i < parts.length; i += 2) {
  if (parts[i].length > 100000) longest.push({ idx: i, len: parts[i].length, head: parts[i].slice(0, 100) });
}
longest.sort((a, b) => b.len - a.len);
for (const l of longest.slice(0, 8)) {
  console.log("huge quoted segment len=" + (l.len / 1048576).toFixed(2) + "MB head:", JSON.stringify(l.head));
}
console.log("segments>100KB total:", longest.reduce((s, l) => s + l.len, 0) / 1048576, "MB");

for (const kw of ["streamdown", "mermaid", "shiki", "textmate", "vscode", "scopeName", "name:", "katex"]) {
  const first = src.indexOf(kw);
  if (first >= 0) console.log("---", kw, "@", first, ":", JSON.stringify(src.slice(Math.max(0, first - 60), first + 100)));
}
