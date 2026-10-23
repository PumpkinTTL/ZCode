import { createElement, type ReactNode } from "react";

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelProviderSectionLayout } from "@/settings/model-provider-section/SectionLayout.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/settings/model-provider-section/Navigation.js", () => ({
  ModelProviderSectionNavigation: () => createElement("nav", null, "providers"),
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));

describe("model provider section layout", () => {
  it("使用最小高度自然分栏，由设置页统一滚动", () => {
    const html = renderToStaticMarkup(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          ModelProviderSectionLayout,
          {
            description: "description",
            refreshLabel: "refresh",
            loadingLabel: "loading",
            customLoading: false,
            onRefresh: vi.fn(),
            addProviderLabel: "add provider",
            onAddProvider: vi.fn(),
            navigationGroups: [],
            selectedNodeKey: null,
            onSelectNavItem: vi.fn(),
          },
          createElement("div", null, "detail"),
        ),
      ),
    );

    expect(html).toContain('data-model-provider-split-panel="true"');
    expect(html).toContain('aria-label="add provider"');
    const refreshButtonIndex = html.indexOf('aria-label="refresh"');
    const addProviderButtonIndex = html.indexOf('aria-label="add provider"');
    expect(refreshButtonIndex).toBeGreaterThan(-1);
    expect(refreshButtonIndex).toBeLessThan(addProviderButtonIndex);
    const addProviderButton =
      html.slice(0, addProviderButtonIndex).match(/<button[^>]*$/)?.[0] ?? "";
    expect(addProviderButton).toContain('data-variant="default"');
    expect(addProviderButton).toContain('data-size="default"');
    expect(html).toContain("min-h-[36rem]");
    expect(html).toContain("overflow-clip");
    expect(html).toContain('data-model-provider-navigation-scroll="true"');
    expect(html).toContain('data-model-provider-detail-scroll="true"');
    expect(html).not.toContain("data-scroll-edge-shadow");
    expect(html).not.toContain("overflow-y-auto");
    expect(html).not.toContain("overscroll-contain");
  });
});
