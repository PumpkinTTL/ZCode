import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_MARKETPLACES, isPublicStoreMarketplaceId } from "../src/index.js";

describe("DEFAULT_PLUGIN_MARKETPLACES", () => {
  it("includes the official CDN marketplace and the Claude official marketplace", () => {
    expect(DEFAULT_PLUGIN_MARKETPLACES).toEqual([
      expect.objectContaining({
        id: "polaris-plugins-official",
        name: "polaris-plugins-official",
        pluginCount: 0,
        source: "https://nimbus.bitlesu.com/plugins/marketplace.json",
      }),
      expect.objectContaining({
        id: "claude-plugins-official",
        name: "claude-plugins-official",
        pluginCount: 0,
        source: "anthropics/claude-plugins-official",
      }),
    ]);
  });

  it("classifies only the Polaris-operated channels as public store marketplaces", () => {
    expect(isPublicStoreMarketplaceId("polaris-plugins-official")).toBe(true);
    expect(isPublicStoreMarketplaceId("zcode-plugins-official")).toBe(false);
    // Claude 官方市场受信但不属于「公开」分段（归个人），见 CONTEXT.md 术语表。
    expect(isPublicStoreMarketplaceId("claude-plugins-official")).toBe(false);
    expect(isPublicStoreMarketplaceId("inline")).toBe(false);
  });
});
