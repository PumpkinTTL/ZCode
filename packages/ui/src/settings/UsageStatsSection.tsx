import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/** Polaris：Coding Plan 使用统计面板已随红线砍除；使用统计只保留 App Usage。 */
export type UsageStatsSectionTab = "app";

export function UsageStatsSection({
  activeTab,
}: {
  activeTab: UsageStatsSectionTab;
  providerSourcesLoading?: boolean;
  workspaceIdentity?: string;
  workspacePath?: string;
}) {
  return <AppUsagePanel />;
}
