/**
 * Polaris：Coding Plan（官方套餐）购买入口已随红线砍除。
 * 此桩保留 useCodingPlanEntryGate / CodingPlanEntryButton 的导入形状：
 * 门禁恒 ready、按钮恒渲染 children 并直接透传 onClick，零出网。
 */
import type { ComponentProps, ReactNode } from "react";

export function useCodingPlanEntryGate(): {
  status: "loading" | "error" | "ready";
  label: undefined;
  retry: undefined;
} {
  return { status: "ready", label: undefined, retry: undefined };
}

export function CodingPlanEntryButton({
  children,
  onClick,
  disabled,
  bypassGate,
  ...props
}: ComponentProps<"button"> & { bypassGate?: boolean; children?: ReactNode }) {
  void bypassGate;
  return (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
