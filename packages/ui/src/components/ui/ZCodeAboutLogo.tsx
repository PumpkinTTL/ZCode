import { cn } from "@/components/lib/utils.js";
import { PolarisAboutLogo, PolarisWordmarkLogo } from "@/components/ui/PolarisAboutLogo.js";

/**
 * 兼容层：品牌图形已统一到 PolarisAboutLogo（北极星）。
 *
 * 保留原导出名与 cn 外壳，使既有调用点（WelcomeScreen / OnboardingWelcomeView）无需改动；
 * 新代码请直接使用 PolarisAboutLogo / PolarisWordmarkLogo。
 */

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return <PolarisAboutLogo className={cn("shrink-0 text-current", className)} />;
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return <PolarisWordmarkLogo className={cn("shrink-0 text-current", className)} />;
}
