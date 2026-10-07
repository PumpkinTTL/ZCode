/**
 * Nimbus 额度展示层的共享格式化函数。
 *
 * 单独成文件（而不是挂在某个面板组件上）是为了让「摘要块 / 大面板 / 窗口迷你卡」
 * 互相引用时不产生组件级循环依赖。
 */

/** 积分数值显示：整数省小数，非整数保留两位。 */
export function formatCredits(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** 积分 → 元（汇率从 /user/me 实时读，禁止写死）。 */
export function creditsToYuan(credits: number, creditsPerYuan: number): string {
  if (creditsPerYuan <= 0) return "—";
  return (credits / creditsPerYuan).toFixed(2);
}

/**
 * 显示层品牌映射：套餐名来自 relay（Nimbus 后端）下发的 `plan_name`，上游口径可能仍
 * 带官方品牌词（如 "ZCode MCP"）。**服务端字段名与取值一律保持原样**，只在渲染前把
 * 用户可见文案映射成 Polaris（默认 "ZCode" → "Polaris"），协议层不做任何改名。
 */
export function formatQuotaPlanName(planName: string): string {
  return planName.replaceAll(/zcode/gi, "Polaris");
}

/** 占比（0-100，钳位）；分母缺失/非正返回 0。 */
export function percentOf(part: number, total: number | null | undefined): number {
  if (total === null || total === undefined || total <= 0) return 0;
  return Math.min(Math.max((part / total) * 100, 0), 100);
}
