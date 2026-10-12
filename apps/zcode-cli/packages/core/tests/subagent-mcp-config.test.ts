import { describe, expect, it } from "vitest";
import { matchesRequiredMcpServer } from "../src/subagent/mcp-config.js";

describe("subagent MCP config", () => {
  it("matches connected plugin MCP servers against their model-visible tool name prefix", () => {
    expect(
      matchesRequiredMcpServer("plugin_device-bridge_device-bridge", {
        "plugin:device-bridge:device-bridge": {
          status: "connected",
          toolCount: 1,
          transport: "stdio",
          updatedAt: new Date(0).toISOString(),
        },
      }),
    ).toBe(true);
  });
});
