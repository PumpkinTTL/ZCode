/**
 * Polaris 品牌 Logo（代码绘制，非素材）：
 * - badge：深色圆角方形底 + 白色北极星四角星 + 弧线轨道（呼应登录窗/关于页形态）；
 * - bare：裸星形线稿（浅色描边跟随文字色，深色渐变），用于轻量品牌位。
 * 纯 SVG，跟随主题；星形为直边四角（直边避免凹弧大星的不雅联想）。
 */
import { cn } from "@/components/lib/utils.js";

export function PolarisLogo({
  size = 64,
  variant = "badge",
  className,
}: {
  size?: number;
  variant?: "badge" | "bare";
  className?: string;
}) {
  const px = `${size}px`;
  if (variant === "bare") {
    return (
      <svg
        aria-hidden="true"
        width={px}
        height={px}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("text-foreground", className)}
      >
        <path
          d="M50 8 Q53 44 92 50 Q53 56 50 92 Q47 56 8 50 Q47 44 50 8 Z M50 26 Q51.5 45 74 50 Q51.5 55 50 74 Q48.5 55 26 50 Q48.5 45 50 26 Z"
          stroke="currentColor"
          fillRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      width={px}
      height={px}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
    >
      <rect width="100" height="100" rx="24" fill="#101012" />
      {/* 北极星：主星（白）+ 弧线轨道（灰）。轨道弧与应用图标同款几何：
          端点在星底两侧、控制点在端点下方——弧向下沉「托住」星底，不是向上拱。 */}
      <path
        d="M50 16 Q54.5 46 84 50 Q54.5 54 50 84 Q45.5 54 16 50 Q45.5 46 50 16 Z"
        fill="#f7f8f8"
      />
      <path
        d="M23 67 Q50 84 77 66"
        stroke="#8a8f98"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
