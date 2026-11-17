/**
 * Polaris：Coding Plan 购买升级弹窗已随红线砍除。
 * 此桩保 provider/hook 导入形状：openCodingPlanUpgrade 恒空、inventory 恒 ready，零出网。
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface CodingPlanUpgradeDialogApi {
  openCodingPlanUpgrade: (params?: Record<string, unknown>) => void;
  inventory?: { status: "loading" | "error" | "ready"; retry?: () => void } | undefined;
}

const CodingPlanUpgradeDialogContext = createContext<CodingPlanUpgradeDialogApi | null>(null);

export function CodingPlanUpgradeDialogProvider({ children }: { children: ReactNode }) {
  const api = useMemo<CodingPlanUpgradeDialogApi>(
    () => ({
      openCodingPlanUpgrade: () => undefined,
      inventory: { status: "ready" },
    }),
    [],
  );
  return (
    <CodingPlanUpgradeDialogContext.Provider value={api}>{children}</CodingPlanUpgradeDialogContext.Provider>
  );
}

export function useCodingPlanUpgradeDialog(): CodingPlanUpgradeDialogApi {
  return useContext(CodingPlanUpgradeDialogContext) ?? { openCodingPlanUpgrade: () => undefined };
}

export function useOptionalCodingPlanUpgradeDialog(): CodingPlanUpgradeDialogApi | null {
  return useContext(CodingPlanUpgradeDialogContext);
}
