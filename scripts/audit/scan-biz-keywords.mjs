// 业务关键词分布扫描（人工复核用）：统计中文业务词在源码里的命中与落点，
// 排除 i18n 文案、测试、dist 与注释行——用于「上游业务残留零残留」类的终扫。
//
// 输出是**候选清单**而非结论：命中可能全部落在站长的自有业务（Nimbus 额度/充值等）
// 或合法的兼容文案上，需要逐个人工判定。
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  "订阅",
  "套餐",
  "支付",
  "充值",
  "积分",
  "折扣",
  "限时",
  "领取",
  "兑换",
  "账单",
  "会员",
  "发票",
];

const files = execSync(
  'git ls-files "packages/*/src/**" "packages/web/src/**" "apps/zcode-cli/packages/**"',
  { encoding: "utf8" },
)
  .split("\n")
  .filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.includes("/dist/") &&
      !f.includes(".test.") &&
      !f.includes("/i18n/"),
  );

const counters = new Map();
for (const p of patterns) counters.set(p, []);

for (const file of files) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const p of patterns) {
    let hits = 0;
    for (const line of src.split("\n")) {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      if (line.includes(p)) hits++;
    }
    if (hits > 0) counters.get(p).push([hits, file]);
  }
}

for (const p of patterns) {
  const list = counters.get(p).sort((a, b) => b[0] - a[0]);
  const total = list.reduce((s, [c]) => s + c, 0);
  console.log(`\n=== ${p}: ${total} 行，${list.length} 文件 ===`);
  for (const [c, f] of list.slice(0, 8)) console.log(`  ${c}  ${f}`);
}
