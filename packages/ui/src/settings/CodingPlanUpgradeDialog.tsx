import { useEffect } from "react";
import type { PurchaseAudience } from "@/settings/model-provider-section/codingPlanEnterpriseTiers.js";

/**
 * Polaris fork：官方套餐购买流程已整体移除。
 *
 * 原先这里渲染 `CodingPlanEmbeddedWebviewDialog`——一个打开 Z.ai 官网 `/coding-plan`、
 * 把官方 OAuth 凭据注入页面 localStorage、并监听官网购买完成信号的内嵌 webview；配套还有
 * 官方 OAuth 登录恢复（`codingPlanUpgradeLoginRecovery`）与购买鉴权判定（`codingPlanPurchaseAuth`）。
 * 这些都与官方账号体系强绑定，自有套餐必然重写，故连同 `codingPlanEmbeddedWebview` 一并删除。
 *
 * 保留的是购买入口的**契约 seam**：`CodingPlanUpgradeDialogTarget` 与组件签名不变，
 * `CodingPlanUpgradeDialogProvider` / `useCodingPlanUpgradeDialog` 等调用方无需改动。
 * 接自有套餐购买流程时，在此渲染自有界面即可。
 */
export interface CodingPlanUpgradeDialogTarget {
  providerId: string;
  initialAudience?: PurchaseAudience;
  initialTeamPlanKey?: string;
}

interface CodingPlanUpgradeDialogProps {
  target?: CodingPlanUpgradeDialogTarget;
  onClose: () => void;
  onOpenResult?: (opened: boolean) => void;
  // 兼容 CodingPlanUpgradeDialogProvider 现有契约。
  onReopen?: (target: CodingPlanUpgradeDialogTarget) => void;
}

export function CodingPlanUpgradeDialog({ target, onOpenResult }: CodingPlanUpgradeDialogProps) {
  // 当前没有可打开的购买界面：向调用方回报“未打开”，避免观察型调用方一直等待。
  useEffect(() => {
    if (target) onOpenResult?.(false);
  }, [target, onOpenResult]);
  return null;
}
