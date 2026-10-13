import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseModelConfig, parseZCodeBuiltinModelConfigRules } from "@zcode/provider";

describe("MCS published capability boundaries", () => {
  it("supports known Claude models across sites, without granting Sonnet or a different API", async () => {
    const release = JSON.parse(
      await readFile(
        new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
        "utf8",
      ),
    );
    const rules = parseZCodeBuiltinModelConfigRules(release.config.modelConfigRules);
    for (const baseUrl of ["https://api.anthropic.com/v1", "https://proxy.example/v1"]) {
      for (const modelId of [
        "claude-opus-4-8",
        "anthropic/claude-opus-4.8",
        "gateway/claude-opus-4-8:free",
        "claude-opus-5",
        "claude-fable-5",
        "claude-fable-5-1",
        "claude-mythos-5-1",
        "claude-sonnet-5",
        "claude-sonnet-4-6",
        "claude-unknown",
      ]) {
        const config = rules.resolve({
          providerId: "fixture",
          modelId,
          baseUrl,
          apiType: "anthropic-messages",
        });
        const expected = !modelId.includes("sonnet") && !modelId.includes("unknown");
        expect(config.properties?.supportsMidConversationSystem, `${baseUrl}/${modelId}`).toBe(
          expected,
        );
        expect(
          config.overlay(parseModelConfig({ properties: { supportsMidConversationSystem: false } }))
            .properties?.supportsMidConversationSystem,
        ).toBe(false);
        expect(
          rules.resolve({
            providerId: "fixture",
            modelId,
            baseUrl,
            apiType: "openai-chat-completions",
          }).properties?.supportsMidConversationSystem,
        ).toBe(false);
      }
    }
    // Polaris：官方套餐 provider 已全部下线，仅存的 nimbus 不在 MCS 站点白名单内，
    // 原「自有 provider 全家保留 MCS」的 provider 循环随之删除；站点白名单本身由下方 URL 断言守护。
    for (const baseUrl of [
      "https://zcode.z.ai/api/v1/off-peak/anthropic/",
      "https://zcode.z.ai/api/v1/zcode-plan/anthropic/",
    ]) {
      expect(
        rules.resolve({
          providerId: "fixture",
          modelId: "unknown",
          apiType: "anthropic-messages",
          baseUrl,
        }).properties?.supportsMidConversationSystem,
      ).toBe(true);
      for (const negative of [
        `${baseUrl}extra`,
        baseUrl.replace("zcode.z.ai", "zcode.z.ai.evil.example"),
      ]) {
        expect(
          rules.resolve({
            providerId: "fixture",
            modelId: "unknown",
            apiType: "anthropic-messages",
            baseUrl: negative,
          }).properties?.supportsMidConversationSystem,
        ).toBe(false);
      }
    }
  });
});
