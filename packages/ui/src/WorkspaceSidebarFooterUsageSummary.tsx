import { BarChart3Icon } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu.js";
import { TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsUsageIntent } from "@/lib/settingsNavigation.js";

/**
 * 侧栏头像菜单的用量入口。原「套餐徽标 + Coding Plan 额度探测」已随官方账号业务移除，
 * 只保留通用的「用量统计」入口（API Key 供应商的用量统计仍然有效）。
 */
export function WorkspaceSidebarFooterUsageSummaryContent({
  onUsageClick,
}: {
  onUsageClick?: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-testid={TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON}
        onSelect={() => {
          setPendingSettingsUsageIntent();
          onUsageClick?.();
        }}
      >
        <BarChart3Icon className="size-4" />
        {intl.formatMessage({ id: "sidebar.usage.plan.openStats" })}
      </DropdownMenuItem>
    </>
  );
}
