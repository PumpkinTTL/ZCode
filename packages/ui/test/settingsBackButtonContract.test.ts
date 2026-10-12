import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

const secondarySurfaces = [
  "CommandsSection.tsx",
  "HookForm.tsx",
  "MemorySettingsViewer.tsx",
  "SubagentsSection.tsx",
  "McpSettingsSection.tsx",
  "PluginStoreDetailView.tsx",
] as const;

const secondaryBackMessageIds = [
  // settings.plugins.store.back / settings.commands.backToList / settings.subagents.backToList
  // 随官方套餐与页内返回入口一起下线（Polaris 走标题栏面包屑）。
  "settings.hooks.backToList",
  "settings.mcp.form.backToList",
] as const;

describe("settings secondary navigation", () => {
  it("二级设置页由标题栏面包屑导航，不再渲染页内返回按钮", async () => {
    for (const fileName of secondarySurfaces) {
      const source = await readFile(
        new URL(`../src/settings/${fileName}`, import.meta.url),
        "utf8",
      );
      expect(source, fileName).not.toContain("<SettingsBackButton");
    }
  });

  it("自动化与闲时任务返回入口保持独立", async () => {
    const automation = await readFile(
      new URL("../src/settings/AutomationEditView.tsx", import.meta.url),
      "utf8",
    );
    const offPeak = await readFile(
      new URL("../src/settings/OffPeakEditView.tsx", import.meta.url),
      "utf8",
    );
    // CodingPlanStatusActions（原生购买/升级面板）已随官方套餐业务下线，不再参与契约。
    expect(automation).not.toContain("SettingsBackButton");
    expect(offPeak).not.toContain("SettingsBackButton");
  });

  it("所有二级设置页返回文案不附带业务对象", () => {
    for (const messageId of secondaryBackMessageIds) {
      expect(zhCN[messageId], messageId).toBe("返回");
      expect(enUS[messageId], messageId).toBe("Back");
    }
  });
});
