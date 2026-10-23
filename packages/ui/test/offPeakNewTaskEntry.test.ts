// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";

const h = vi.hoisted(() => {
  const initialize = vi.fn(async () => {});
  const dismissNewTaskBanner = vi.fn();
  const setPendingCreateDraft = vi.fn();
  const refreshCodingPlanSupport = vi.fn(async () => {});
  const loggerDebug = vi.fn();
  const toast = vi.fn();
  const messages: { current: Record<string, string> } = { current: {} };
  const locale = { current: "en-US" };
  const offPeakTemplateIds = {
    current: ["standupGitSummary", "ciFlakyReport", "customize"] as string[],
  };
  const remoteTemplateCopy = {
    standupGitSummary: {
      en: {
        title: "Remote standup summary",
        description: "Remote Friday summary",
        prompt: "Summarize the remote standup.",
      },
      cn: { title: "远程站会摘要", description: "远程周五摘要", prompt: "汇总远程站会。" },
    },
    ciFlakyReport: {
      en: {
        title: "Remote CI report",
        description: "Remote CI failures",
        prompt: "Review the remote CI report.",
      },
      cn: { title: "远程 CI 报告", description: "远程 CI 失败", prompt: "检查远程 CI 报告。" },
    },
    documentationSyncCheck: {
      en: {
        title: "Remote docs check",
        description: "Remote documentation sync",
        prompt: "Review remote documentation.",
      },
      cn: { title: "远程文档检查", description: "远程文档同步", prompt: "检查远程文档。" },
    },
  };
  const providerSettingsState = {
    view: null as import("@zcode/services").ProviderSettingsView | null,
  };
  const state = {
    loading: false,
    grayConfig: {
      enabled: true,
      modelSelectionView: { revision: 1, providers: [] },
    },
    codingPlanSupport: {
      supported: false,
      reason: "connection_unselected",
    },
    newTaskBannerDismissed: false,
    initialize,
    refreshCodingPlanSupport,
    dismissNewTaskBanner,
    setPendingCreateDraft,
  };
  const settings = {
    providerFamilyDomain: undefined as "zai" | "bigmodel" | undefined,
    modelProviderFamilyModes: {} as Record<string, "oauth" | "apiKey">,
    modelProviderFamilySelectedKeys: {} as Record<string, string>,
  };
  // 真实 useServices 返回的是稳定的 Context 值；mock 若每次调用都新建对象，
  // 组件任何一次重渲染都会让 initialize 的依赖变化并重复拉取灰度配置。
  const services = {
    offPeakTaskService: {},
    codingPlanSubscriptionService: {},
  };
  return {
    initialize,
    loggerDebug,
    locale,
    messages,
    offPeakTemplateIds,
    providerSettingsState,
    refreshCodingPlanSupport,
    services,
    setPendingCreateDraft,
    settings,
    state,
    toast,
    remoteTemplateCopy,
  };
});

vi.mock("@/components/ui/toast.js", () => ({ toast: h.toast }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => h.services,
}));
vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({
    state: h.providerSettingsState.view
      ? { status: "ready", view: h.providerSettingsState.view }
      : { status: "loading" },
    reload: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ settings: h.settings }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: h.locale.current,
    intl: {
      formatMessage: ({ id }: { id: string }) => h.messages.current[id] ?? id,
    },
  }),
}));
vi.mock("@/settings/useAutomationTemplates.js", () => ({
  useAutomationTemplates: () => ({
    scheduled: [],
    rejectedScheduledTemplateIds: [],
    offPeak: h.offPeakTemplateIds.current.map((id) => {
      const customize = id === "customize" || id === "item-customize";
      const copy = customize
        ? null
        : h.remoteTemplateCopy[
            id as "standupGitSummary" | "ciFlakyReport" | "documentationSyncCheck"
          ];
      return {
        id,
        title: copy ? { en: copy.en.title, cn: copy.cn.title } : {},
        // Automations 仍展示 contents；首页必须显式读取 homepageDescription（descs 映射结果）。
        description: copy
          ? { en: `contents:${copy.en.description}`, cn: `contents:${copy.cn.description}` }
          : {},
        homepageDescription: copy ? { en: copy.en.description, cn: copy.cn.description } : {},
        prompt: copy ? { en: copy.en.prompt, cn: copy.cn.prompt } : { en: "", cn: "" },
        customize,
        icon: customize ? "customize" : id,
        ...(customize
          ? {}
          : {
              iconName:
                id === "standupGitSummary"
                  ? "git-commit-horizontal"
                  : id === "ciFlakyReport"
                    ? "activity"
                    : "file-text",
            }),
      };
    }),
  }),
}));
vi.mock("@/logger.js", () => ({
  logger: { debug: h.loggerDebug },
}));
vi.mock("@/store/offPeakTaskStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/offPeakTaskStore.js")>();
  return {
    ...actual,
    useOffPeakTaskStore: (selector: (state: typeof h.state) => unknown) => selector(h.state),
  };
});

import { OffPeakNewTaskEntry } from "@/v4/OffPeakNewTaskEntry.js";
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";

function renderEntry(props: { onOpenAutomations?: () => void } = {}) {
  return render(createElement(OffPeakNewTaskEntry, props));
}

function clickStandupTemplate(onOpenAutomations = vi.fn()) {
  renderEntry({ onOpenAutomations });
  fireEvent.click(
    screen.getByRole("button", {
      name: /Remote standup summary Remote Friday summary/,
    }),
  );
  return onOpenAutomations;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.loading = false;
  h.state.grayConfig = {
    enabled: true,
    modelSelectionView: { revision: 1, providers: [] },
  };
  h.state.codingPlanSupport = {
    supported: false,
    reason: "connection_unselected",
  };
  h.providerSettingsState.view = {
    revision: 1,
    addableProviders: [],
    providerOrder: [],
    providers: [],
  };
  h.messages.current = {};
  h.locale.current = "en-US";
  h.offPeakTemplateIds.current = ["standupGitSummary", "ciFlakyReport", "customize"];
  h.settings.providerFamilyDomain = undefined;
  h.settings.modelProviderFamilyModes = {};
  h.settings.modelProviderFamilySelectedKeys = {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OffPeakNewTaskEntry", () => {
  it("远程目录为空时显示本地 Customize 入口", () => {
    h.offPeakTemplateIds.current = [];

    renderEntry();

    expect(screen.getByRole("button", { name: /Customize/i })).not.toBeNull();
  });

  it("首页只展示前两条普通远程模板，并把本地 Customize 固定放在最后", () => {
    h.offPeakTemplateIds.current = [
      "standupGitSummary",
      "item-customize",
      "ciFlakyReport",
      "documentationSyncCheck",
    ];

    const view = renderEntry();
    const cards = view.container.querySelectorAll<HTMLElement>(
      "[data-off-peak-template-grid] > button",
    );

    expect(cards).toHaveLength(3);
    expect(Array.from(cards, (card) => card.textContent)).toEqual([
      "Remote standup summaryRemote Friday summary",
      "Remote CI reportRemote CI failures",
      "offPeak.newTask.template.customize.titleoffPeak.newTask.template.customize.description",
    ]);
    expect(view.container.textContent).not.toContain("Remote docs check");
  });

  it("远端模板图标和本地 Customize 图标接线", async () => {
    const view = renderEntry();
    const templateGrid = view.container.querySelector<HTMLElement>("[data-off-peak-template-grid]");
    const cards = templateGrid?.querySelectorAll<HTMLElement>("button") ?? [];

    expect(cards).toHaveLength(3);
    await waitFor(() => {
      expect(
        cards[0]?.querySelector('[data-client-scene-lucide-icon="git-commit-horizontal"]'),
      ).not.toBeNull();
      expect(cards[1]?.querySelector('[data-client-scene-lucide-icon="activity"]')).not.toBeNull();
    });
    expect(cards[2]?.querySelector('[data-off-peak-homepage-template-icon="moon"]')).not.toBeNull();
  });
  it("keeps the dismiss control implemented but hidden in this design round", () => {
    const view = renderEntry();
    const closeButton = view.container.querySelector<HTMLElement>(
      "[data-off-peak-new-task-dismiss]",
    );

    expect(closeButton).not.toBeNull();
    expect(closeButton?.classList.contains("hidden")).toBe(true);
  });

  it("横幅文案可聚焦并承接 Tooltip", () => {
    renderEntry();

    const copy = screen.getByText("offPeak.newTask.bannerText");
    expect(copy.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(copy.tabIndex).toBe(0);
  });

  it("首次挂载交由共享机制初始化和登记 freshness，连接变化后刷新", () => {
    const view = renderEntry();

    expect(h.initialize).toHaveBeenCalledOnce();
    // 去重归 Store 所有；这里验证组件交付通知，不再要求它自行跳过首次通知。
    expect(h.refreshCodingPlanSupport).toHaveBeenCalledOnce();
    view.rerender(createElement(OffPeakNewTaskEntry));
    expect(h.refreshCodingPlanSupport).toHaveBeenCalledOnce();

    h.settings.providerFamilyDomain = "zai";
    h.settings.modelProviderFamilyModes = { zai: "oauth" };
    h.settings.modelProviderFamilySelectedKeys = { zai: "zai-coding-plan" };
    view.rerender(createElement(OffPeakNewTaskEntry));

    expect(h.refreshCodingPlanSupport).toHaveBeenCalledTimes(2);
  });

  it("Provider Settings 尚未水合时不把未知状态误判为无套餐", () => {
    h.providerSettingsState.view = null;
    const onOpenAutomations = clickStandupTemplate();

    expect(h.toast).not.toHaveBeenCalled();
    expect(h.setPendingCreateDraft).toHaveBeenCalledOnce();
    expect(onOpenAutomations).toHaveBeenCalledOnce();
  });

  it.each([
    {
      locale: "zh-CN",
      messages: zhCN,
      bannerText: "新功能体验：创建「闲时任务」，我们将在算力富余时段免费为你完成指派任务。",
      bannerTipText: "本功能在算力富余时段免费执行，不额外占用常规任务额度。",
      fullCopy:
        "新功能体验：创建「闲时任务」，我们将在算力富余时段免费为你完成指派任务。本功能在算力富余时段免费执行，不额外占用常规任务额度。",
      copySeparator: "",
    },
    {
      locale: "en-US",
      messages: enUS,
      bannerText:
        'New: create an "Idle-time task" and we will complete your assigned task for free during periods of surplus computing power.',
      bannerTipText:
        "This feature runs for free during surplus computing power and does not consume your regular task quota.",
      fullCopy:
        'New: create an "Idle-time task" and we will complete your assigned task for free during periods of surplus computing power. This feature runs for free during surplus computing power and does not consume your regular task quota.',
      copySeparator: " ",
    },
  ])(
    "$locale 首页展示、提示与模板预填使用同一种语言",
    ({ locale, messages, bannerText, bannerTipText }) => {
      h.messages.current = messages;
      h.locale.current = locale;
      h.providerSettingsState.view = {
        revision: 2,
        addableProviders: [],
        providerOrder: [],
        providers: [
          {
            providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            enabled: true,
            executable: true,
            effectiveConfig: {
              label: "Z.ai Coding Plan",
              access: {
                type: "zhipu-account",
                family: "zai",
                mode: "individual-coding-plan",
                entitled: true,
              },
              api: {
                type: "anthropic-messages",
                baseUrl: "https://example.com",
              },
              builtinModelIds: ["glm-5"],
            },
            issues: [],
            models: [],
          },
        ],
      };

      const copy = h.remoteTemplateCopy.standupGitSummary[locale === "zh-CN" ? "cn" : "en"];
      const { title, description, prompt } = copy;
      const onOpenAutomations = vi.fn();

      render(createElement(OffPeakNewTaskEntry, { onOpenAutomations }));
      const bannerCopy = screen.getByText(bannerText);
      fireEvent.focus(bannerCopy);
      const tipCopies = screen.getAllByText(bannerTipText);
      expect(tipCopies.length).toBeGreaterThan(0);
      const templateCard = screen.getByRole("button", {
        name: `${title} ${description}`,
      });
      fireEvent.click(templateCard);

      expect(h.toast).not.toHaveBeenCalled();
      // Polaris：模板点击只暂存预填草稿（无遥测来源字段，遥测链路整批未合入）。
      expect(h.setPendingCreateDraft).toHaveBeenCalledWith({
        title,
        prompt,
      });
      expect(onOpenAutomations).toHaveBeenCalledOnce();
    },
  );
});
