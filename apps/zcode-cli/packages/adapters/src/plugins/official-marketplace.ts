import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { writePluginTextIfChanged } from "./helpers.js";
import { withFileLock } from "@zcode/shared/node";
import { ZCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@zcode/contracts";

const BUNDLED_PARTITION_FILE = "bundled-marketplace.json";
const CDN_PARTITION_FILE = "cdn-marketplace.json";
const MERGED_MARKETPLACE_FILE = "marketplace.json";

interface BundledMarketplacePartition {
  manifest: Record<string, unknown>;
  version: 1;
}

export async function writeBundledOfficialMarketplacePartition(input: {
  manifest: Record<string, unknown>;
  storageRoot: string;
}): Promise<Record<string, unknown>> {
  assertOfficialManifest(input.manifest);
  return publishPartition(input.storageRoot, async () => {
    await writeJsonFile(partitionPath(input.storageRoot, BUNDLED_PARTITION_FILE), {
      manifest: input.manifest,
      version: 1,
    } satisfies BundledMarketplacePartition);
  });
}

export async function writeCdnOfficialMarketplacePartition(input: {
  manifest: Record<string, unknown>;
  storageRoot: string;
<<<<<<< HEAD
}): Record<string, unknown> {
  const persistedManifest = normalizeOfficialManifest(input.manifest);
  writeJsonFileSync(partitionPath(input.storageRoot, CDN_PARTITION_FILE), persistedManifest);
  return rebuildOfficialMarketplaceSync(input.storageRoot);
}

export function loadBundledOfficialPluginRootsSync(storageRoot: string): string[] | undefined {
  const bundledPartition = readBundledPartition(storageRoot);
=======
}): Promise<Record<string, unknown>> {
  assertOfficialManifest(input.manifest);
  return publishPartition(input.storageRoot, async () => {
    await writeJsonFile(partitionPath(input.storageRoot, CDN_PARTITION_FILE), input.manifest);
  });
}

async function publishPartition(
  storageRoot: string,
  write: () => Promise<void>,
): Promise<Record<string, unknown>> {
  // 启动 seed 和商店刷新可来自不同进程。分片写入和合并发布同属一次事务，
  // 使用目录文件本身的锁，不递归获取外层安装锁，也不会锁住普通查询。
  return withFileLock(partitionPath(storageRoot, MERGED_MARKETPLACE_FILE), async () => {
    await write();
    return rebuildOfficialMarketplace(storageRoot);
  });
}

export async function loadBundledOfficialPluginRoots(
  storageRoot: string,
): Promise<string[] | undefined> {
  const bundledPartition = await readBundledPartition(storageRoot);
>>>>>>> upstream/main
  if (!bundledPartition) return undefined;

  const officialCacheRoot = resolve(storageRoot, "cache", ZCODE_OFFICIAL_PLUGIN_MARKETPLACE);
  return readPluginEntries(bundledPartition.manifest).flatMap((plugin) => {
    const name = readPluginName(plugin);
    const cachePath = typeof plugin.cachePath === "string" ? plugin.cachePath : undefined;
    if (!name || !cachePath) return [];

    const pluginCacheRoot = resolve(officialCacheRoot, name);
    const resolvedCachePath = resolve(cachePath);
    if (
      !isStrictDescendant(officialCacheRoot, pluginCacheRoot) ||
      !isStrictDescendant(pluginCacheRoot, resolvedCachePath)
    ) {
      return [];
    }
    return [resolvedCachePath];
  });
}

async function rebuildOfficialMarketplace(storageRoot: string): Promise<Record<string, unknown>> {
  const bundledPartition = await readBundledPartition(storageRoot);
  const cdnManifest = await readJsonRecord(partitionPath(storageRoot, CDN_PARTITION_FILE));
  const bundledManifest = bundledPartition?.manifest;
  const cdnPlugins = readPluginEntries(cdnManifest);
  const cdnPluginNames = new Set(cdnPlugins.map(readPluginName).filter(isDefined));
  const bundledPlugins = readPluginEntries(bundledManifest).filter((plugin) => {
    const name = readPluginName(plugin);
    return name !== undefined && !cdnPluginNames.has(name);
  });

  // 内置插件与 CDN 插件曾使用两个 marketplace id，UI 会把内置市场当成
  // 无 source 的独立市场并在刷新时报 not found。两个分片必须独立持久化后再合并，
  // 否则应用启动时的 seed 会覆盖 CDN 目录，或 CDN 刷新会覆盖内置目录。同名时以
  // 可刷新的 CDN 市场条目为准，但只过滤合并目录，不删除应用内置缓存。
  //
  // 身份（name / description / owner）归 Polaris：远端镜像只贡献"内容"字段。
  // 否则镜像 manifest 里的厂商品牌（如 `owner: {name: "Z.ai"}` 与它的 description）
  // 会随合并写入本地状态，最后显示成官方目录自己的品牌与文案。
  const merged = {
    ...readCdnContributedFields(cdnManifest),
    ...(bundledManifest ?? {}),
    name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE,
    plugins: [...cdnPlugins, ...bundledPlugins],
  };
  await writeJsonFile(partitionPath(storageRoot, MERGED_MARKETPLACE_FILE), merged);
  return merged;
}

<<<<<<< HEAD
/**
 * 允许从远端镜像目录带入的"内容"字段白名单。
 *
 * `featured` 是策展名单，`allowCrossMarketplaceDependenciesOn` 是跨市场依赖白名单——两者
 * 都是内容声明。其余字段（name / description / owner / …）属于目录身份，必须由本地决定，
 * 不能由镜像覆盖。
 */
const CDN_CONTRIBUTED_FIELDS = ["featured", "allowCrossMarketplaceDependenciesOn"] as const;

function readCdnContributedFields(
  cdnManifest: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!cdnManifest) return {};
  const contributed: Record<string, unknown> = {};
  for (const field of CDN_CONTRIBUTED_FIELDS) {
    if (field in cdnManifest) contributed[field] = cdnManifest[field];
  }
  return contributed;
}

function readBundledPartition(storageRoot: string): BundledMarketplacePartition | undefined {
  const value = readJsonRecord(partitionPath(storageRoot, BUNDLED_PARTITION_FILE));
=======
async function readBundledPartition(
  storageRoot: string,
): Promise<BundledMarketplacePartition | undefined> {
  const value = await readJsonRecord(partitionPath(storageRoot, BUNDLED_PARTITION_FILE));
>>>>>>> upstream/main
  if (!value || value.version !== 1 || !isRecord(value.manifest)) return undefined;
  return {
    manifest: value.manifest,
    version: 1,
  };
}

function readPluginEntries(
  manifest: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  return Array.isArray(manifest?.plugins) ? manifest.plugins.filter(isRecord) : [];
}

function readPluginName(plugin: Record<string, unknown>): string | undefined {
  return typeof plugin.name === "string" && plugin.name.length > 0 ? plugin.name : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isStrictDescendant(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return (
    relativePath.length > 0 &&
    !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`)
  );
}

function assertOfficialManifest(manifest: Record<string, unknown>): void {
  if (manifest.name !== ZCODE_OFFICIAL_PLUGIN_MARKETPLACE) {
    throw new Error(
      `Official marketplace manifest must be named ${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
    );
  }
}

/**
 * 官方目录镜像 manifest 的归一化：远端可以携带历史声明名（Z.ai 原站至今如此），
 * 但落盘的身份字段必须是本地官方 id —— 与 rebuild 的字段白名单同一原则（镜像只贡献内容）。
 */
function normalizeOfficialManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error("Official marketplace manifest must declare a name");
  }
  return manifest.name === ZCODE_OFFICIAL_PLUGIN_MARKETPLACE
    ? manifest
    : { ...manifest, name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE };
}

function partitionPath(storageRoot: string, fileName: string): string {
  return join(storageRoot, "marketplaces", ZCODE_OFFICIAL_PLUGIN_MARKETPLACE, fileName);
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writePluginTextIfChanged(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
