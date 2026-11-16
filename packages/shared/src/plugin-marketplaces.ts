import { resolveZCodeRuntimeEnv } from "./runtimeEnv.js";

export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "polaris-plugins-official";

/** Polaris 自有官方目录静态地址（静态清单镜像，排在自有后端动态端点之后）。 */
export const POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL =
  "https://nimbus.bitlesu.com/plugins/marketplace.json";

/** 官方目录的 Polaris 自有描述；镜像（含 Z.ai 原站）的品牌字段不得覆盖它。 */
export const POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION =
  "Polaris plugins marketplace: built-in and community plugins for Polaris.";

/**
 * cbcn-cloud 自有市场的公开端点（生产默认第一优先；与额度服务同域 nimbus）。
 * 由后端代理 `GET /api/v1/public/plugin-marketplace.json` 提供，返回与静态清单
 * 同构的 marketplace manifest。
 */
export const NIMBUS_OFFICIAL_PLUGIN_MARKETPLACE_URL =
  "https://nimbus.bitlesu.com/api/v1/public/plugin-marketplace.json";

/**
 * 开发（未打包）联调的本地 cbcn-cloud 市场端点：与额度 base 的 dev 口径一致
 * （ZCODE_RUNTIME_ENV=development → 127.0.0.1:8000，打包生产永不命中本地）。
 */
export const DEV_NIMBUS_OFFICIAL_PLUGIN_MARKETPLACE_URL =
  "http://127.0.0.1:8000/api/v1/public/plugin-marketplace.json";

/**
 * 上游（Z.ai 原站）兼容镜像的 URL——**已退出默认镜像链，仅作为显式 opt-in 保留**。
 *
 * 历史：站长令 2026-10-10 曾把它挂在默认链末尾（自有目录内容就绪前先用上游目录撑消费端市场）。
 * 该口径下商店每次刷新都必然打上游：自有动态端点返回 `plugins: []`（实测 200 + 空目录）、
 * 静态清单路径返回 HTML 而非 JSON，按「不可达或空目录继续降级」的规则走到本项才拿到内容——
 * 既是上游业务出网，也是每次刷新的失败/降级日志来源。
 *
 * 2026-10-13 按「上游业务一律砍除」的红线把本项移出默认链（生产链与开发链都不再包含它）。
 * 需要临时回退时用环境变量显式指定，不改代码：
 * `POLARIS_PLUGIN_MARKETPLACE_MIRRORS=<本 URL>`（见 `POLARIS-PLUGIN-MARKETPLACE.md` §6.1.1）。
 * 镜像只贡献内容——manifest 声明的历史名会被 adapter 归一化（身份归 Polaris，镜像只供内容）。
 */
export const ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL =
  "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json";

/**
 * 官方目录（`polaris-plugins-official`）的镜像源（生产默认顺序），按优先级排序：
 * 靠前的先试，失败**或自有源目录为空**才降级到下一个。实际取用请走
 * {@link resolveOfficialPluginMarketplaceMirrors}（它会按运行环境替换第一优先，
 * 并支持 {@link PLUGIN_MARKETPLACE_MIRRORS_ENV} 完全覆盖）。
 */
export const OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS: readonly string[] = [
  NIMBUS_OFFICIAL_PLUGIN_MARKETPLACE_URL,
  POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL,
];

/**
 * 覆盖官方目录镜像顺序的环境变量（逗号或换行分隔，靠前的优先）。
 *
 * 例：`POLARIS_PLUGIN_MARKETPLACE_MIRRORS=https://nimbus.bitlesu.com/api/v1/public/plugin-marketplace.json`
 * 只保留自有源；或写一个自建镜像让它排最前。
 */
export const PLUGIN_MARKETPLACE_MIRRORS_ENV = "POLARIS_PLUGIN_MARKETPLACE_MIRRORS";

/**
 * 解析官方目录镜像源顺序。环境变量非空时完全覆盖内置默认（顺序即优先级）；
 * 未配置时回到内置默认链，并按运行环境替换第一优先：未打包开发实例
 * （ZCODE_RUNTIME_ENV=development，desktop main 注入口径与 resolveQuotaBaseUrl 一致）
 * 回落本地 cbcn-cloud，其余（打包生产 / CLI / 浏览器）用静态默认链。
 */
export function resolveOfficialPluginMarketplaceMirrors(env?: NodeJS.ProcessEnv): string[] {
  const resolvedEnv = env ?? (typeof process === "undefined" ? undefined : process.env);
  const overridden = parsePluginMarketplaceSourceList(
    resolvedEnv?.[PLUGIN_MARKETPLACE_MIRRORS_ENV],
  );
  if (overridden.length > 0) return overridden;
  const runtimeEnv = resolvedEnv ? resolveZCodeRuntimeEnv(resolvedEnv) : "production";
  return runtimeEnv === "development"
    ? [DEV_NIMBUS_OFFICIAL_PLUGIN_MARKETPLACE_URL, POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL]
    : [...OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS];
}

/**
 * Claude Code 官方市场（GitHub git 源）。它不是 ZCode 的强依赖：GitHub 不可达时刷新必然失败，
 * 该失败不应作为错误提示打扰用户，UI 侧按此 id 静默处理其刷新失败（任何原因）。
 */
export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "claude-plugins-official";

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@polaris-plugins-official",
  "image-search@polaris-plugins-official",
  "documents@polaris-plugins-official",
  "pdf@polaris-plugins-official",
  "presentations@polaris-plugins-official",
  "spreadsheets@polaris-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己
  // 不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@polaris-plugins-official",
  "skill-creator@polaris-plugins-official",
  "plugin-creator@polaris-plugins-official",
  "zcode-guide@polaris-plugins-official",
  "zcode-site@polaris-plugins-official",
  // 电脑控制和交互视图默认关闭，故 computer-use、visualize 不在此名单内。
  // 该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，
  // bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者。
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // Polaris：插件市场能力保留，源改指自有地址，并保留镜像降级能力。
    // 本地 seed 分片仍在 Agent storage 内合并；CDN/镜像 manifest 的 name 允许是历史名
    // （polaris-plugins-official），adapter 层会归一化为本地官方 id —— 身份归 Polaris，镜像只贡献内容。
    // 自有市场尚未部署时，刷新会按 OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS 降级到下一个镜像；
    // 全部不可达且本地无快照时才会报错，不影响本地已安装/内置插件。
    id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL,
    name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION,
    pluginCount: 0,
  },
  {
    id: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "anthropics/claude-plugins-official",
    name: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description:
      "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
    // 只内置官方 catalog 来源，不把远端 manifest 快照打包进仓库；首次刷新前数量未知。
    pluginCount: 0,
  },
];

// 商店「公开」分段只有一个官方市场 id，内置与 CDN 不再拆分身份。
export const PUBLIC_STORE_MARKETPLACE_IDS = [ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}

/**
 * 预置市场源（Preset Marketplace）：可一键添加的公开 `.claude-plugin/marketplace.json` 目录。
 *
 * 与 {@link DEFAULT_PLUGIN_MARKETPLACES} 的区别：默认源由 Polaris 自带并自动登记；预置源只是
 * 「建议清单」，必须由用户显式添加后才联网，因此默认安装不发任何指向第三方的请求。
 *
 * 这里的 `source` 都是 GitHub `owner/repo` 简写，交由 adapter 的 `parseMarketplaceSourceInput`
 * 解析为 `github` 源（与 Claude Code 的 `marketplace add owner/repo` 语义一致）。
 * `catalogName` 是该目录 `.claude-plugin/marketplace.json` 顶层声明的 `name`——添加后会成为
 * 该市场的 id，用于在 UI 里判断「已添加」，请勿臆造。
 */
export interface PresetPluginMarketplace {
  /** UI 稳定 key 与过滤用 slug；不是 marketplace id（id 由目录 manifest 的 name 决定）。 */
  id: string;
  /** 可直接添加的源串（GitHub `owner/repo` 简写或 URL）。 */
  source: string;
  /** UI 展示名。 */
  name: string;
  /** UI 展示描述。 */
  description: string;
  /** 目录 manifest 声明的 name（添加后的 marketplace id）；外部注入源可能未知。 */
  catalogName?: string;
  homepage?: string;
  /** 归属/授权说明，用于商店来源标注与合规审查。 */
  license?: string;
}

/**
 * 公开市场源清单。每一项都经过核对：仓库根确有一份 `.claude-plugin/marketplace.json`，
 * 且能给出稳定的声明名与非空条目。增删时请重新核对（见 `POLARIS-PLUGIN-MARKETPLACE.md`）。
 */
export const PRESET_PLUGIN_MARKETPLACES: readonly PresetPluginMarketplace[] = [
  {
    id: "claude-plugins-official",
    source: "anthropics/claude-plugins-official",
    name: "Claude Plugins Official",
    description: "Anthropic 维护的官方 Claude Code 插件目录（含内部插件与通过审核的第三方插件）。",
    catalogName: "claude-plugins-official",
    homepage: "https://github.com/anthropics/claude-plugins-official",
    license: "每个插件各自的 LICENSE",
  },
  {
    id: "composio-awesome-claude-plugins",
    source: "composio-community/awesome-claude-plugins",
    name: "Awesome Claude Plugins",
    description: "Composio 社区维护的精选插件合集。",
    catalogName: "awesome-claude-plugins",
    homepage: "https://github.com/composio-community/awesome-claude-plugins",
    license: "每个插件各自的 LICENSE",
  },
  {
    id: "claude-code-skills",
    source: "alirezarezvani/claude-skills",
    name: "Claude Code Skills",
    description: "规模最大的开源技能库之一，兼容 Claude Code / Codex / Gemini CLI / Cursor。",
    catalogName: "claude-code-skills",
    homepage: "https://github.com/alirezarezvani/claude-skills",
    license: "每个插件各自的 LICENSE",
  },
  {
    id: "sylvain-marketplace",
    source: "sgaunet/claude-plugins",
    name: "Sylvain's Plugins",
    description: "精选的 agents / skills / commands 合集。",
    catalogName: "sylvain-marketplace",
    homepage: "https://github.com/sgaunet/claude-plugins",
    license: "每个插件各自的 LICENSE",
  },
  {
    id: "xiaolai",
    source: "xiaolai/claude-plugin-marketplace",
    name: "xiaolai Marketplace",
    description: "同时面向 Claude Code 与 OpenAI Codex CLI 的中央市场。",
    catalogName: "xiaolai",
    homepage: "https://github.com/xiaolai/claude-plugin-marketplace",
    license: "每个插件各自的 LICENSE",
  },
  {
    id: "agent37-skills",
    source: "agent37-platform/agent37-skills-collection",
    name: "Agent 37 Skills",
    description: "Agent 37 平台维护的技能合集。",
    catalogName: "agent37-skills",
    homepage: "https://github.com/agent37-platform/agent37-skills-collection",
    license: "每个插件各自的 LICENSE",
  },
  // 注：`dvcrn/openclaw-skills-marketplace`（26k+ 条目）不在预置清单内——
  // 它的仓库归档超过 GitHub archive 源的 200MB 上限，添加会直接失败。
  // 需要时可由用户手动添加（或等它的体积回落）；预置清单只保留实测可添加的目录。
];

/**
 * 外部工具注入的额外市场源环境变量。
 *
 * 逗号或换行分隔，每项是一个可被 `parseMarketplaceSourceInput` 接受的源串
 * （GitHub `owner/repo`、git URL、本地路径等）。注入的源进入「预置/建议」列表，
 * 仍由用户显式添加后才联网——因此它是给外部工具/hub 用的稳定接入点，而不是静默联网开关。
 *
 * 例：`POLARIS_PLUGIN_MARKETPLACE_SOURCES=my-org/my-hub,https://git.example.com/team/plugins.git`
 */
export const PLUGIN_MARKETPLACE_SOURCES_ENV = "POLARIS_PLUGIN_MARKETPLACE_SOURCES";

/**
 * 归一化市场源串，仅用于「预置源是否已添加」的比较：忽略协议头、`github.com/` 前缀、
 * 尾部 `.git`、尾部斜杠与大小写差异。
 */
export function normalizeMarketplaceSourceForCompare(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/^https?:\/\//u, "")
    .replace(/^www\./u, "")
    .replace(/^github\.com\//u, "")
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
}

/** 已登记市场的最小结构：只需 id 与 source（source 形如 {source:"github", repo/url}）。 */
interface KnownMarketplaceLike {
  id: string;
  source: unknown;
}

/**
 * 判断一个预置市场源是否已被添加。先按目录声明名（添加后会成为 marketplace id）匹配，
 * 再回退到 source 里的 repo/url 归一化比较，避免用户重复添加同一个目录。
 */
export function isPresetMarketplaceAdded(
  preset: PresetPluginMarketplace,
  marketplaces: readonly KnownMarketplaceLike[],
): boolean {
  const target = normalizeMarketplaceSourceForCompare(preset.source);
  return marketplaces.some((marketplace) => {
    if (preset.catalogName && marketplace.id === preset.catalogName) return true;
    const source = marketplace.source as { repo?: unknown; url?: unknown } | null | undefined;
    if (!source) return false;
    return [source.repo, source.url].some(
      (value) =>
        typeof value === "string" && normalizeMarketplaceSourceForCompare(value) === target,
    );
  });
}

/** 解析环境变量里的源串列表：按逗号/换行切分、去空、去重，保持首次出现顺序。 */
export function parsePluginMarketplaceSourceList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value.split(/[,\n]/u)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** 由源串派生一个稳定的 UI slug；只用于展示与去重，不影响 marketplace id。 */
function presetIdFromSource(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return `external:${slug.length > 0 ? slug : "source"}`;
}

/**
 * 合并内置预置清单与外部注入源（{@link PLUGIN_MARKETPLACE_SOURCES_ENV}）。
 * 以源串字符串为键去重：若外部源与内置预置指向同一源，保留内置预置的展示信息。
 */
export function resolvePresetPluginMarketplaces(
  env?: NodeJS.ProcessEnv,
): PresetPluginMarketplace[] {
  const presets: PresetPluginMarketplace[] = [...PRESET_PLUGIN_MARKETPLACES];
  const known = new Set(presets.map((preset) => preset.source));
  // 该模块同时被 Node 与浏览器（renderer）导入，`process` 在浏览器不存在；不传 env 时
  // 退回读取全局 process.env（若可用），否则只返回内置预置清单。
  const resolvedEnv = env ?? (typeof process === "undefined" ? undefined : process.env);
  for (const source of parsePluginMarketplaceSourceList(
    resolvedEnv?.[PLUGIN_MARKETPLACE_SOURCES_ENV],
  )) {
    if (known.has(source)) continue;
    known.add(source);
    presets.push({
      id: presetIdFromSource(source),
      source,
      name: source,
      description: "外部工具注入的插件市场源。",
    });
  }
  return presets;
}
