/**
 * Polaris：本地插件同步（候选扫描 / 归档导出导入 / 远端判重）是企业自有功能。
 * 上游 v3.18 将 plugin-sync 重构为 data-sync 统一形状并移除了这套 API；
 * 此模块把企业实现整体保留，包装回 IPluginSyncService 的旧方法面。
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  PluginSyncArchiveExportResult,
  PluginSyncCandidate,
  PluginSyncCandidateListResult,
  PluginSyncComponentType,
  PluginSyncImportResult,
  PluginSyncRemoteStatus,
} from "@zcode/shared";
import {
  createPluginSyncArchive,
  extractPluginSyncArchive,
  PLUGIN_SYNC_METADATA_ARCHIVE_PATH,
  type PluginSyncArchiveMetadata,
} from "./pluginSyncArchive.js";
import { normalizePluginSyncRelativePath, resolvePluginSyncPathWithin } from "./pluginSyncPath.js";
import { checkRemoteSyncDirectoriesWriteAccess } from "../remote-sync/remoteSyncWriteAccess.js";
import type { RemoteSyncWriteAccessResult } from "@zcode/shared";
import { DATA_ROOT_DIR_NAME } from "../paths.js";

const INLINE_PLUGIN_MARKETPLACE = "inline";
const USER_CONFIG_FILE_MODE = 0o600;
const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  [".zcode-plugin", "plugin.json"],
  [".claude-plugin", "plugin.json"],
  [".codex-plugin", "plugin.json"],
] as const;

interface PluginManifestInfo {
  name: string;
  pluginId: string;
  description?: string;
  version?: string;
  componentTypes: PluginSyncComponentType[];
}

interface UserPluginConfigState {
  dirs: string[];
  enabledOverrides: Map<string, boolean>;
}

/** IPluginSyncService 上企业自有的候选/归档方法面。 */
export interface PluginSyncCandidateMethods {
  listLocalUserPluginCandidates(): Promise<PluginSyncCandidateListResult>;
  listRemoteUserPluginStatuses(params: {
    plugins: Array<{
      pluginId: string;
      directoryName: string;
    }>;
  }): Promise<{ statuses: PluginSyncRemoteStatus[] }>;
  exportPluginsArchive(params: { pluginIds: string[] }): Promise<PluginSyncArchiveExportResult>;
  importPluginsArchive(params: {
    archive: Uint8Array;
    overwrite?: boolean;
  }): Promise<PluginSyncImportResult>;
  checkRemoteUserPluginWriteAccess(): Promise<RemoteSyncWriteAccessResult>;
}

export function createPluginSyncCandidateMethods(options?: {
  maxArchiveBytes?: number;
}): PluginSyncCandidateMethods {
  const maxArchiveBytes = options?.maxArchiveBytes ?? 50 * 1024 * 1024;
  return {
    async listLocalUserPluginCandidates() {
      return {
        candidates: await collectLocalUserPluginCandidates(),
        maxArchiveBytes,
      };
    },
    async listRemoteUserPluginStatuses(params) {
      const targetRoot = getUserZcodePluginRoot();
      const existingPluginPathById = await collectConfiguredInlinePluginPathById();
      return {
        statuses: params.plugins.map((plugin): PluginSyncRemoteStatus => {
          const directoryName = normalizePluginSyncRelativePath(plugin.directoryName);
          const pluginId = normalizePluginId(plugin.pluginId);
          const targetPath = resolvePluginSyncPathWithin(targetRoot, directoryName);
          if (existsSync(targetPath)) {
            return {
              pluginId,
              directoryName,
              exists: true,
              path: targetPath,
              reason: "targetExists",
            };
          }
          const existingPath = existingPluginPathById.get(normalizePluginIdKey(pluginId));
          return existingPath
            ? {
                pluginId,
                directoryName,
                exists: true,
                path: existingPath,
                reason: "samePluginId",
              }
            : { pluginId, directoryName, exists: false };
        }),
      };
    },
    async exportPluginsArchive(params) {
      const candidates = await collectLocalUserPluginCandidates();
      const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const selected = params.pluginIds.map((id) => {
        const candidate = candidateById.get(id);
        if (!candidate) {
          throw new Error(`plugin sync candidate not found: ${id}`);
        }
        return candidate;
      });
      const selectedBytes = selected.reduce((total, candidate) => total + candidate.sizeBytes, 0);
      if (selectedBytes > maxArchiveBytes) {
        throw new Error(`plugin sync archive exceeds limit: ${selectedBytes}/${maxArchiveBytes}`);
      }
      const archive = await createPluginSyncArchive({
        entries: await Promise.all(
          selected.map(async (candidate) => ({
            sourcePath: await realpath(candidate.path),
            archivePath: candidate.directoryName,
          })),
        ),
        metadata: {
          plugins: selected.map((candidate) => ({
            name: candidate.name,
            pluginId: candidate.pluginId,
            directoryName: candidate.directoryName,
            ...(candidate.enabledOverride !== undefined
              ? { enabled: candidate.enabledOverride }
              : {}),
          })),
        },
      });
      if (archive.byteLength > maxArchiveBytes) {
        throw new Error(
          `plugin sync archive exceeds limit: ${archive.byteLength}/${maxArchiveBytes}`,
        );
      }
      return {
        archive,
        archiveBytes: archive.byteLength,
        plugins: selected.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          pluginId: candidate.pluginId,
          directoryName: candidate.directoryName,
          ...(candidate.enabledOverride !== undefined
            ? { enabled: candidate.enabledOverride }
            : {}),
        })),
      };
    },
    async importPluginsArchive(params) {
      if (params.overwrite) {
        throw new Error("plugin sync overwrite is not supported");
      }
      if (params.archive.byteLength > maxArchiveBytes) {
        throw new Error(
          `plugin sync archive exceeds limit: ${params.archive.byteLength}/${maxArchiveBytes}`,
        );
      }
      return await importPluginsArchive(params.archive, maxArchiveBytes);
    },
    async checkRemoteUserPluginWriteAccess() {
      return checkRemoteSyncDirectoriesWriteAccess([
        getUserZcodePluginRoot(),
        dirname(getUserZcodeConfigPath()),
      ]);
    },
  };
}

async function collectLocalUserPluginCandidates(): Promise<PluginSyncCandidate[]> {
  const config = await readUserPluginConfigState();
  const candidates: PluginSyncCandidate[] = [];
  const seenRealpaths = new Set<string>();
  const usedDirectoryNames = new Set<string>();

  for (const rawDir of config.dirs) {
    const pluginRoot = resolve(rawDir);
    const canonicalRoot = await realpath(pluginRoot).catch(() => pluginRoot);
    if (seenRealpaths.has(canonicalRoot)) {
      continue;
    }
    seenRealpaths.add(canonicalRoot);
    const manifest = await readPluginManifestInfo(canonicalRoot);
    if (!manifest) {
      continue;
    }
    const enabledOverride = config.enabledOverrides.get(normalizePluginIdKey(manifest.pluginId));
    const directoryName = createUniqueDirectoryName(
      basename(canonicalRoot),
      manifest.name,
      canonicalRoot,
      usedDirectoryNames,
    );
    candidates.push({
      id: createCandidateId(manifest.pluginId, canonicalRoot),
      name: manifest.name,
      pluginId: manifest.pluginId,
      directoryName,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      path: canonicalRoot,
      sizeBytes: await computeRecursiveSize(canonicalRoot),
      enabled: enabledOverride ?? true,
      ...(enabledOverride !== undefined ? { enabledOverride } : {}),
      componentTypes: manifest.componentTypes,
    });
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

async function readUserPluginConfigState(): Promise<UserPluginConfigState> {
  const parsed = await readJsonFileOrEmpty(getUserZcodeConfigPath());
  const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
  const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
  const enabledOverrides = new Map<string, boolean>();
  for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
    if (typeof enabled === "boolean") {
      enabledOverrides.set(normalizePluginIdKey(pluginId), enabled);
    }
  }
  return {
    dirs: readStringArray(plugins.dirs),
    enabledOverrides,
  };
}

async function collectConfiguredInlinePluginPathById(): Promise<Map<string, string>> {
  const config = await readUserPluginConfigState();
  const result = new Map<string, string>();
  for (const rawDir of config.dirs) {
    const pluginRoot = resolve(rawDir);
    const canonicalRoot = await realpath(pluginRoot).catch(() => pluginRoot);
    const manifest = await readPluginManifestInfo(canonicalRoot);
    if (!manifest) {
      continue;
    }
    const pluginIdKey = normalizePluginIdKey(manifest.pluginId);
    if (!result.has(pluginIdKey)) {
      result.set(pluginIdKey, canonicalRoot);
    }
  }
  return result;
}

async function importPluginsArchive(
  archive: Uint8Array,
  maxArchiveBytes: number,
): Promise<PluginSyncImportResult> {
  const tempRoot = join(tmpdir(), `zcode-plugin-sync-${randomUUID()}`);
  try {
    await extractPluginSyncArchive(archive, tempRoot, {
      maxExtractedBytes: maxArchiveBytes,
    });
    const metadata = await readArchiveMetadata(tempRoot);
    const targetRoot = getUserZcodePluginRoot();
    const existingPluginPathById = await collectConfiguredInlinePluginPathById();
    const results: PluginSyncImportResult["results"] = [];

    for (const plugin of metadata.plugins) {
      const directoryName = normalizePluginSyncRelativePath(plugin.directoryName);
      const pluginId = normalizePluginId(plugin.pluginId);
      const extractedPath = resolvePluginSyncPathWithin(tempRoot, directoryName);
      const targetPath = resolvePluginSyncPathWithin(targetRoot, directoryName);
      let stagingPath: string | undefined;
      try {
        const manifest = await readPluginManifestInfo(extractedPath);
        if (!manifest) {
          throw new Error(`plugin manifest not found: ${directoryName}`);
        }
        if (normalizePluginIdKey(manifest.pluginId) !== normalizePluginIdKey(pluginId)) {
          throw new Error(`plugin manifest id mismatch: ${manifest.pluginId} !== ${pluginId}`);
        }
        if (existsSync(targetPath)) {
          results.push({
            name: manifest.name,
            pluginId,
            directoryName,
            status: "skipped",
            path: targetPath,
          });
          continue;
        }
        const existingPath = existingPluginPathById.get(normalizePluginIdKey(pluginId));
        if (existingPath) {
          results.push({
            name: manifest.name,
            pluginId,
            directoryName,
            status: "skipped",
            path: existingPath,
          });
          continue;
        }
        await mkdir(dirname(targetPath), { recursive: true });
        stagingPath = resolvePluginSyncPathWithin(
          targetRoot,
          `.importing-${toSafeDirectoryName(directoryName)}-${randomUUID()}`,
        );
        await cp(extractedPath, stagingPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        if (existsSync(targetPath)) {
          throw new Error(`plugin target already exists: ${targetPath}`);
        }
        await rename(stagingPath, targetPath);
        stagingPath = undefined;
        // 远端 plugin 只有目录落盘还不会被 Agent runtime 发现；
        // 必须在同一个远端服务里追加远端绝对路径，避免写回本机 plugins.dirs。
        try {
          await addPluginDirToUserConfig(targetPath, pluginId, plugin.enabled);
        } catch (error) {
          // inline plugin 目录落盘但 config 写失败会形成半同步状态；
          // 重试会把目录误判为远端已有，所以必须回滚本次刚创建的目标目录。
          await rm(targetPath, { recursive: true, force: true });
          throw error;
        }
        existingPluginPathById.set(normalizePluginIdKey(pluginId), targetPath);
        results.push({
          name: manifest.name,
          pluginId,
          directoryName,
          status: "synced",
          path: targetPath,
        });
      } catch (error) {
        if (stagingPath) {
          await rm(stagingPath, { recursive: true, force: true });
        }
        results.push({
          name: plugin.name,
          pluginId,
          directoryName,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { results };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readArchiveMetadata(tempRoot: string): Promise<PluginSyncArchiveMetadata> {
  const raw = await readFile(join(tempRoot, PLUGIN_SYNC_METADATA_ARCHIVE_PATH), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
    throw new Error("invalid plugin sync archive metadata");
  }
  const plugins: PluginSyncArchiveMetadata["plugins"] = [];
  for (const item of parsed.plugins) {
    if (!isRecord(item)) {
      throw new Error("invalid plugin sync archive plugin metadata");
    }
    const name = readRequiredString(item.name, "plugin metadata name");
    const pluginId = normalizePluginId(readRequiredString(item.pluginId, "plugin metadata id"));
    const directoryName = normalizePluginSyncRelativePath(
      readRequiredString(item.directoryName, "plugin metadata directory"),
    );
    plugins.push({
      name,
      pluginId,
      directoryName,
      ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
    });
  }
  return { plugins };
}

async function addPluginDirToUserConfig(
  pluginPath: string,
  pluginId: string,
  enabledOverride: boolean | undefined,
): Promise<void> {
  const filePath = getUserZcodeConfigPath();
  const parsed = await readJsonFileOrEmpty(filePath);
  const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
  const resolvedPluginPath = resolve(pluginPath);
  const dirs = readStringArray(plugins.dirs);
  const nextDirs = dirs.map((item) => resolve(item)).includes(resolvedPluginPath)
    ? dirs
    : [...dirs, resolvedPluginPath];
  const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
  await writeJsonFileAtomic(filePath, {
    ...parsed,
    plugins: {
      ...plugins,
      dirs: nextDirs,
      ...(enabledOverride !== undefined
        ? {
            enabledPlugins: {
              ...enabledPlugins,
              [pluginId]: enabledOverride,
            },
          }
        : Object.keys(enabledPlugins).length > 0
          ? { enabledPlugins }
          : {}),
    },
  });
}

async function readPluginManifestInfo(pluginRoot: string): Promise<PluginManifestInfo | null> {
  for (const segments of PLUGIN_MANIFEST_RELATIVE_PATHS) {
    const manifestPath = join(pluginRoot, ...segments);
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf-8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    if (!isRecord(parsed)) {
      return null;
    }
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) {
      return null;
    }
    return {
      name,
      pluginId: `${name}@${INLINE_PLUGIN_MARKETPLACE}`,
      ...(typeof parsed.description === "string" && parsed.description.trim()
        ? { description: parsed.description.trim() }
        : {}),
      ...(typeof parsed.version === "string" && parsed.version.trim()
        ? { version: parsed.version.trim() }
        : {}),
      componentTypes: await resolvePluginComponentTypes(pluginRoot, parsed),
    };
  }
  return null;
}

async function resolvePluginComponentTypes(
  pluginRoot: string,
  manifest: Record<string, unknown>,
): Promise<PluginSyncComponentType[]> {
  const componentTypes: PluginSyncComponentType[] = [];
  if ("skills" in manifest || (await pathExists(join(pluginRoot, "skills")))) {
    componentTypes.push("skills");
  }
  if ("commands" in manifest || (await pathExists(join(pluginRoot, "commands")))) {
    componentTypes.push("commands");
  }
  if ("hooks" in manifest || (await pathExists(join(pluginRoot, "hooks", "hooks.json")))) {
    componentTypes.push("hooks");
  }
  if ("mcpServers" in manifest || (await pathExists(join(pluginRoot, ".mcp.json")))) {
    componentTypes.push("mcp");
  }
  return componentTypes;
}

async function computeRecursiveSize(path: string): Promise<number> {
  const pathStat = await lstat(path);
  if (pathStat.isFile()) {
    return pathStat.size;
  }
  if (!pathStat.isDirectory()) {
    return 0;
  }
  let total = 0;
  for (const entry of await readdir(path)) {
    total += await computeRecursiveSize(join(path, entry));
  }
  return total;
}

function createUniqueDirectoryName(
  directoryBasename: string,
  pluginName: string,
  pluginRoot: string,
  usedDirectoryNames: Set<string>,
): string {
  const baseName = toSafeDirectoryName(directoryBasename || pluginName);
  if (!usedDirectoryNames.has(baseName)) {
    usedDirectoryNames.add(baseName);
    return baseName;
  }
  const dedupedName = toSafeDirectoryName(`${baseName}-${createShortHash(pluginRoot).slice(0, 8)}`);
  usedDirectoryNames.add(dedupedName);
  return dedupedName;
}

function toSafeDirectoryName(value: string): string {
  const sanitized = value.trim().replace(/[\\/:]/gu, "-") || "plugin";
  try {
    return normalizePluginSyncRelativePath(sanitized);
  } catch {
    return `plugin-${createShortHash(value).slice(0, 8)}`;
  }
}

function createCandidateId(pluginId: string, pluginRoot: string): string {
  return createShortHash(`${pluginId}:${pluginRoot}`);
}

function createShortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePluginId(pluginId: string): string {
  const normalized = pluginId.trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`invalid plugin id: ${pluginId}`);
  }
  return normalized;
}

function normalizePluginIdKey(pluginId: string): string {
  return normalizePluginId(pluginId).toLowerCase();
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing ${label}`);
  }
  return value.trim();
}

async function readJsonFileOrEmpty(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`invalid json object: ${filePath}`);
  }
  return parsed;
}

async function writeJsonFileAtomic(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(dirname(filePath), `.tmp-${basename(filePath)}-${randomUUID()}`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    mode: USER_CONFIG_FILE_MODE,
  });
  await rename(tempPath, filePath);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveUserHomeDir(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}

function getUserZcodeConfigPath(): string {
  return join(resolveUserHomeDir(), DATA_ROOT_DIR_NAME, "cli", "config.json");
}

function getUserZcodePluginRoot(): string {
  return join(resolveUserHomeDir(), DATA_ROOT_DIR_NAME, "plugins");
}
