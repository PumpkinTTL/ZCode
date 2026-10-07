import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";
import type { Theme } from "@/useTheme.js";

interface ThemeHeroPalette {
  panel: string;
  meshBase: string;
  meshLight: string;
  glowPrimary: string;
  glowSecondary: string;
  heading: string;
  description: string;
}

function getThemeHeroPalette(theme: Theme): ThemeHeroPalette {
  switch (theme) {
    case "light":
      return {
        meshBase: "#eff6ff",
        meshLight: "#7dd3fc",
        panel: "bg-background",
        glowPrimary: "bg-sky-200/70 mix-blend-screen",
        glowSecondary: "bg-blue-200/70 mix-blend-multiply",
        heading: "text-slate-900",
        description: "text-slate-700/80",
      };
    case "zai-light":
      return {
        meshBase: "#f8f8f8",
        meshLight: "#80beff",
        panel: "bg-background",
        glowPrimary: "bg-[#80BEFF]/45 mix-blend-multiply",
        glowSecondary: "bg-[#EBF4FF]/80 mix-blend-multiply",
        heading: "text-[#0D0D0D]",
        description: "text-[#5C5C5C]",
      };
    case "zai-dark":
      return {
        meshBase: "#001d3d",
        meshLight: "#80beff",
        panel: "bg-background",
        glowPrimary: "bg-[#4099FF]/22 mix-blend-screen",
        glowSecondary: "bg-[#80BEFF]/16 mix-blend-screen",
        heading: "text-[#F8F8F8]",
        description: "text-[#ADADAD]",
      };
    case "dark":
    case "system":
    default:
      return {
        meshBase: "#060816",
        meshLight: "#60a5fa",
        panel: "bg-background",
        glowPrimary: "bg-cyan-300/22 mix-blend-screen",
        glowSecondary: "bg-blue-400/18 mix-blend-screen",
        heading: "text-slate-50",
        description: "text-slate-200/72",
      };
  }
}

export function useResolvedThemeHeroPalette(): ThemeHeroPalette {
  const theme = useZCodeStore((state) => state.theme);
  const resolvedTheme =
    theme === "system" ? (resolveTheme(theme) === "dark" ? "dark" : "light") : theme;

  return getThemeHeroPalette(resolvedTheme);
}

export function ThemeHeroVisual(props: {
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}) {
  const palette = useResolvedThemeHeroPalette();

  return (
    <div className={cn("relative overflow-hidden", palette.panel, props.className)}>
      {props.children ? (
        <div className={cn("relative z-10", props.contentClassName)}>{props.children}</div>
      ) : null}
    </div>
  );
}
