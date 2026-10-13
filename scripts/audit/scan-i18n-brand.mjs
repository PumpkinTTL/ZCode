// 审计脚本：列出 i18n locale 文件中「值」里含上游品牌的条目。
// 只读，不改文件。用法：node scripts/audit/scan-i18n-brand.mjs
import { readFileSync } from "node:fs";

const targets = [
  ["zh-CN", "packages/ui/src/i18n/locales/zh-CN.ts"],
  ["en-US", "packages/ui/src/i18n/locales/en-US.ts"],
];
const BRAND = /ZCode|智谱|ChatGLM|Z\.ai|bigmodel|zhipuai/i;

for (const [locale, file] of targets) {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/u);
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // 跳过注释行（品牌名在注释里是合理的排查线索）
    if (/^\s*(\/\/|\*|\/\*)/u.test(line)) continue;
    const match = line.match(/^\s*"[^"]+":\s*(.*)$/u);
    if (!match) continue;
    let value = match[1];
    // 值在下一行的情况
    if (value.trim() === "") {
      const next = lines[index + 1] ?? "";
      if (/^\s*(\/\/|\*|\/\*)/u.test(next)) continue;
      value = next.trim();
    }
    if (BRAND.test(value)) {
      hits.push({ line: index + 1, key: (line.match(/^\s*"([^"]+)"/u) ?? [])[1], value: value.slice(0, 130) });
    }
  }
  console.log(`=== ${locale} (${file}) — ${hits.length} 条命中 ===`);
  for (const hit of hits) {
    console.log(`  L${hit.line}  ${hit.key}  =>  ${hit.value}`);
  }
  console.log();
}
