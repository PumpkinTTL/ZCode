/**
 * MCP 用户目录模块 - 类型和常量定义
 */

import type { CliMcpSource, McpFileFormat } from "@zcode/shared";
import { DATA_ROOT_DIR_NAME } from "@zcode/services/node";

/**
 * MCP 配置键名类型
 * - mcpServers: 通用 JSON 目录格式（.agents/mcp.json）
 * - mcp.servers: zcode CLI config.json 格式
 */
export type McpConfigKeyName = "mcpServers" | "mcp.servers";

export interface McpSourceDescriptor {
  source: CliMcpSource;
  configDirSegments: string[];
  fileName: string;
  format: McpFileFormat;
  configKeyName: McpConfigKeyName;
}

// Polaris fork：这里只描述**用户级** CLI 配置目录，目录名跟数据根走（`.polaris`），
// 与 packages/services/src/paths.ts 的 DATA_ROOT_DIR_NAME 一致；workspace 级不在此列。
export const MCP_SOURCE_DESCRIPTORS: McpSourceDescriptor[] = [
  {
    source: "zcodeagentmcp",
    configDirSegments: [DATA_ROOT_DIR_NAME, "cli"],
    fileName: "config.json",
    format: "json",
    configKeyName: "mcp.servers",
  },
];

export function getSourceDescriptor(source: CliMcpSource): McpSourceDescriptor {
  const descriptor = MCP_SOURCE_DESCRIPTORS.find((item) => item.source === source);
  if (!descriptor) {
    throw new Error(`Unsupported MCP source: ${source}`);
  }
  return descriptor;
}
