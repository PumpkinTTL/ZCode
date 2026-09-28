/**
 * Polaris：官方套餐购买流程已整体移除，这个弹窗位由**自有业务**接管。
 *
 * 保留了原契约 seam（target / onClose / onOpenResult / onReopen 与调用方不变），
 * 但渲染的是我们自己的「Nimbus 账号（登录 + 额度）」弹窗——
 * 接自有套餐购买流程时，同样在这一层扩展，调用方依旧无需改动。
 */
import { useEffect } from "react";
import { NimbusAccountDialog } from "@/business/quota/NimbusAccountDialog.js";

export interface CodingPlanUpgradeDialogTarget {
  providerId: string;
  initialAudience?: string;
  initialTeamPlanKey?: string;
}

interface CodingPlanUpgradeDialogProps {
  target?: CodingPlanUpgradeDialogTarget;
  onClose: () => void;
  onOpenResult?: (opened: boolean) => void;
  // 兼容 CodingPlanUpgradeDialogProvider 现有契约。
  onReopen?: (target: CodingPlanUpgradeDialogTarget) => void;
}

export function CodingPlanUpgradeDialog({
  target,
  onClose,
  onOpenResult,
}: CodingPlanUpgradeDialogProps) {
  // 弹窗位已被自有业务接管：能打开就向观察方回报 true，避免调用方一直等待。
  useEffect(() => {
    if (target) onOpenResult?.(true);
  }, [target, onOpenResult]);

  return <NimbusAccountDialog open={target !== undefined} onClose={onClose} />;
}
