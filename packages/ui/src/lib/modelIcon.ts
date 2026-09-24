/**
 * 模型 ID → 品牌图标 slug 的**唯一**策略点。
 *
 * 分隔符两侧的语义：
 * - `modelId` 是身份，决定品牌标。看不到具体模型时不要退回显示名（昵称是表现，不该改图标）。
 * - `providerId` 只在模型族认不出来时兜底；经聚合平台转发的模型仍然显示原厂标，
 *   所以模型族规则**永远**排在 provider 兜底之前。
 */
interface ModelIconRule {
  readonly slug: string;
  readonly pattern: RegExp;
}

/** 按优先级排列；越靠前越先命中。正则统一按小写模型 ID 匹配。 */
const MODEL_ICON_RULES: readonly ModelIconRule[] = [
  // 智谱 / GLM 系：GLM 是模型商标，charglm / codegeex 是智谱的历史子品牌。
  { slug: "codegeex", pattern: /^codegeex/ },
  { slug: "chatglm", pattern: /^charglm|^chatglm/ },
  { slug: "zhipu", pattern: /(^|\/)(z-ai|zhipu)\/|^glm[-.\d]|^emohaa/ },

  // Anthropic
  { slug: "anthropic", pattern: /(^|\/)anthropic\/|^claude[-.\d]/ },

  // OpenAI
  { slug: "openai", pattern: /(^|\/)openai\/|^gpt[-.\d]|^gpt-oss|^o[1-9](?:-|$)|^text-davinci|^chatgpt/ },

  // DeepSeek
  { slug: "deepseek", pattern: /(^|\/)deepseek\/|^deepseek/ },

  // Moonshot / Kimi：k3 / k2 / k1 是 Kimi 的短型号。
  { slug: "kimi", pattern: /(^|\/)(moonshotai|moonshot)\/|^kimi|^k[1-3](?:-|$)/ },

  // MiniMax
  { slug: "minimax", pattern: /(^|\/)minimax\/|^minimax|^abab/ },

  // 小米 MiMo
  { slug: "xiaomimimo", pattern: /(^|\/)xiaomi\/|^mimo[-.\d]|^xiaomi/ },

  // 阿里 Qwen
  { slug: "qwen", pattern: /(^|\/)(qwen|alibaba)\/|^qwen|^tongyi/ },

  // xAI Grok
  { slug: "grok", pattern: /(^|\/)x-ai\/|^grok/ },

  // Google
  { slug: "gemma", pattern: /^gemma/ },
  { slug: "gemini", pattern: /(^|\/)google\/|^gemini|^palm[-.\d]|^learnlm/ },

  // Meta Llama
  { slug: "meta", pattern: /(^|\/)meta(-llama)?\/|^llama|^codellama/ },

  // 其他国际厂商
  { slug: "mistral", pattern: /^mistral|^mixtral|^codestral|^devstral|^magistral|^pixtral/ },
  { slug: "cohere", pattern: /(^|\/)cohere\/|^command[-a-z]|^aya/ },
  { slug: "perplexity", pattern: /^sonar/ },
  { slug: "nvidia", pattern: /^nemotron|^llama-3\.[\d]+-nemotron/ },
  { slug: "microsoft", pattern: /^phi[-.\d]/ },
  { slug: "nousresearch", pattern: /(^|\/)nousresearch\/|^hermes[-.\d]|^nous-/ },
  { slug: "upstage", pattern: /^solar[-.\d]/ },
  { slug: "antgroup", pattern: /^ling[-.\d]|^ring[-.\d]/ },

  // 国内厂商
  { slug: "hunyuan", pattern: /(^|\/)tencent\/|^hunyuan|^hy\d/ },
  { slug: "stepfun", pattern: /(^|\/)stepfun\/|^step[-.\d]/ },
  { slug: "wenxin", pattern: /^ernie|^wenxin/ },
  { slug: "doubao", pattern: /(^|\/)(volcengine|bytedance)\/|^doubao|^seed[-.\d]/ },
  { slug: "yi", pattern: /(^|\/)(01-ai|zero-one)\/|^yi[-.\d]/ },
  { slug: "baichuan", pattern: /^baichuan/ },
  { slug: "internlm", pattern: /^internlm/ },
];

/**
 * Provider 身份兜底表：模型族认不出来时，用接入方的品牌标。
 * 只列「品牌标能代表接入方」的平台；zai / bigmodel 这类官方账号 Provider 归到对应模型族标上。
 */
const PROVIDER_ICON_SLUGS: Readonly<Record<string, string>> = {
  openrouter: "openrouter",
  opencode: "opencode",
  ollama: "ollama",
  huggingface: "huggingface",
  groq: "groq",
  azure: "azure",
  bedrock: "aws",
  vertexai: "google",
  deepinfra: "deepinfra",
  together: "together",
  fireworks: "fireworks",
  novita: "novita",
  siliconcloud: "siliconcloud",
  modelscope: "modelscope",
  bailian: "bailian",
  volcengine: "volcengine",
  tencentcloud: "tencentcloud",
  huawei: "huawei",
  zai: "zai",
  bigmodel: "zhipu",
  zhipu: "zhipu",
};

/** `account:zai-individual-coding-plan` / `opencode-zen-chat` → `zai` / `opencode`。 */
function normalizeProviderToken(providerId: string): string {
  return providerId
    .trim()
    .toLowerCase()
    .replace(/^account:/, "")
    .split(/[-:]/)[0]!;
}

/**
 * 解析模型应显示的品牌图标 slug。
 * 认不出品牌时返回 `null`，由调用方渲染通用兜底图标——不猜、不套用其他品牌标。
 */
export function resolveModelIconSlug(
  modelId: string | null | undefined,
  providerId?: string | null,
): string | null {
  const normalizedModelId = modelId?.trim().toLowerCase() ?? "";
  if (normalizedModelId) {
    for (const rule of MODEL_ICON_RULES) {
      if (rule.pattern.test(normalizedModelId)) {
        return rule.slug;
      }
    }
  }

  const normalizedProviderId = providerId?.trim().toLowerCase() ?? "";
  if (normalizedProviderId) {
    const token = normalizeProviderToken(normalizedProviderId);
    const slug = PROVIDER_ICON_SLUGS[token];
    if (slug) return slug;
  }

  return null;
}
