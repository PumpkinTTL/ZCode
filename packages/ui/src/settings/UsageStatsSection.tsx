import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/** 使用统计分区。原 Coding Plan 套餐用量 tab 已随官方账号业务移除，只保留应用用量。 */
export function UsageStatsSection() {
  return <AppUsagePanel />;
}
