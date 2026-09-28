// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

// Polaris：产品身份前缀。这是模型自称的唯二来源之一（另一个是 sections/identity.ts 的 Agent Identity），
// 改这里等于改「模型认为自己是谁」；仓库内没有任何代码解析这句话，纯注入文本。
const CLI_PREFIX_PROMPT = "You are Polaris, an interactive coding agent";

export function buildCliPrefixSection(): ContextSection {
  const content = CLI_PREFIX_PROMPT;

  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
