import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getZCodePluginsOverview, updateZCodePluginMarketplace } from "../src/plugins.js";
import { PLUGIN_MARKETPLACE_MIRRORS_ENV } from "@zcode/shared";

const MARKETPLACE_ID = "degradation-fixture";
const MARKETPLACE_DIR = join("marketplaces", MARKETPLACE_ID);
const OFFICIAL_MARKETPLACE_ID = "zcode-plugins-official";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 三级降级（remote → snapshot → bundled）的第 2 级：
 * 目录刷新失败、但本地保有上一次成功目录时，必须降级为 warning 而不是 error，
 * 否则 `zcode plugins update <plugin>` 会因一次网络抖动直接拒绝更新。
 */
test("marketplace refresh failure degrades to a warning while a local catalog exists", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "polaris-marketplace-degraded-"));
  try {
    const missingSource = join(storageRoot, "does-not-exist");
    await writeJson(join(storageRoot, "known_marketplaces.json"), {
      version: 1,
      marketplaces: [
        {
          id: MARKETPLACE_ID,
          source: { source: "directory", path: missingSource },
          name: MARKETPLACE_ID,
          addedAt: "2026-01-01T00:00:00.000Z",
          lastUpdated: "2026-01-01T00:00:00.000Z",
          pluginCount: 1,
        },
      ],
    });
    // 上一次成功的目录快照仍在本地。
    await writeJson(join(storageRoot, MARKETPLACE_DIR, "marketplace.json"), {
      name: MARKETPLACE_ID,
      plugins: [{ name: "example-plugin", description: "fixture" }],
    });

    const result = await updateZCodePluginMarketplace({
      marketplace: MARKETPLACE_ID,
      pluginStorageRoot: storageRoot,
      workingDirectory: storageRoot,
    });

    const relevant = result.diagnostics.filter((item) => item.pluginId === MARKETPLACE_ID);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0]?.severity, "warning");
    assert.match(relevant[0]?.message ?? "", /keeping the last successful catalog/u);
    assert.equal(
      result.diagnostics.some((item) => item.severity === "error"),
      false,
      "degraded refresh must not surface a blocking error",
    );
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

/**
 * 无法降级时（没有可用目录）仍必须是 error：那才是真的什么都没有，
 * 降级不能把这种情况也吞掉。
 */
test("marketplace refresh failure stays an error when no local catalog exists", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "polaris-marketplace-failed-"));
  try {
    const missingSource = join(storageRoot, "also-missing");
    await writeJson(join(storageRoot, "known_marketplaces.json"), {
      version: 1,
      marketplaces: [
        {
          id: MARKETPLACE_ID,
          source: { source: "directory", path: missingSource },
          name: MARKETPLACE_ID,
          addedAt: "2026-01-01T00:00:00.000Z",
          pluginCount: 0,
        },
      ],
    });

    const result = await updateZCodePluginMarketplace({
      marketplace: MARKETPLACE_ID,
      pluginStorageRoot: storageRoot,
      workingDirectory: storageRoot,
    });

    const relevant = result.diagnostics.filter((item) => item.pluginId === MARKETPLACE_ID);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0]?.severity, "error");
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

/**
 * overview 也必须降级：它是进商店页时真正被调用的入口，如果这里仍把刷新失败当 error，
 * UI 会一进页面就弹红条（`fetch failed`），即使本地快照完全可用。
 */
test("plugins overview degrades a refresh failure to a warning, not a store error", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "polaris-marketplace-overview-"));
  try {
    await writeJson(join(storageRoot, "known_marketplaces.json"), {
      version: 1,
      marketplaces: [
        {
          id: MARKETPLACE_ID,
          source: { source: "url", url: "https://127.0.0.1:1/unreachable.json" },
          name: MARKETPLACE_ID,
          addedAt: "2026-01-01T00:00:00.000Z",
          lastUpdated: "2026-01-01T00:00:00.000Z",
          lastRefreshFailure: {
            code: "plugin_marketplace_invalid",
            failedAt: "2026-01-02T00:00:00.000Z",
            message: "fetch failed",
          },
          pluginCount: 1,
        },
      ],
    });
    await writeJson(join(storageRoot, MARKETPLACE_DIR, "marketplace.json"), {
      name: MARKETPLACE_ID,
      plugins: [{ name: "example-plugin", description: "fixture" }],
    });

    const overview = getZCodePluginsOverview({
      pluginStorageRoot: storageRoot,
      workingDirectory: storageRoot,
    });

    const relevant = overview.diagnostics.filter((item) => item.pluginId === MARKETPLACE_ID);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0]?.severity, "warning");
    assert.match(relevant[0]?.message ?? "", /keeping the last successful catalog/u);
    // 快照照常投影到商店，列表不会因为一次刷新失败而变空。
    assert.equal(
      overview.availablePlugins.some((item) => item.id === `example-plugin@${MARKETPLACE_ID}`),
      true,
    );
    // 降级标记下发给 UI，用于渲染「离线目录」而不是报错。
    const summary = overview.marketplaces.find((item) => item.id === MARKETPLACE_ID);
    assert.equal(summary?.degraded, true);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

/**
 * 官方目录镜像降级：镜像列表里的源不可达时，必须按优先级继续尝试下一个候选，
 * 最终回退到 known record 自己的 source。这覆盖「Z.ai 原站作镜像」的核心路径。
 */
test("official marketplace falls through unreachable mirrors in priority order", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "polaris-marketplace-mirror-"));
  const previousMirrors = process.env[PLUGIN_MARKETPLACE_MIRRORS_ENV];
  try {
    // 一个指向必然失败的地址的镜像，优先级高于 record.source。
    process.env[PLUGIN_MARKETPLACE_MIRRORS_ENV] = "https://127.0.0.1:1/unreachable.json";

    const catalogRoot = join(storageRoot, "official-catalog");
    await writeJson(join(catalogRoot, ".claude-plugin", "marketplace.json"), {
      name: OFFICIAL_MARKETPLACE_ID,
      plugins: [{ name: "mirror-plugin", description: "fixture" }],
    });
    await writeJson(join(storageRoot, "known_marketplaces.json"), {
      version: 1,
      marketplaces: [
        {
          id: OFFICIAL_MARKETPLACE_ID,
          source: { source: "directory", path: catalogRoot },
          name: OFFICIAL_MARKETPLACE_ID,
          addedAt: "2026-01-01T00:00:00.000Z",
          pluginCount: 0,
        },
      ],
    });

    const result = await updateZCodePluginMarketplace({
      marketplace: OFFICIAL_MARKETPLACE_ID,
      pluginStorageRoot: storageRoot,
      workingDirectory: storageRoot,
    });

    assert.equal(
      result.diagnostics.some((item) => item.severity === "error"),
      false,
      "falling through to a reachable mirror must not surface an error",
    );
    const official = result.marketplaces.find((item) => item.id === OFFICIAL_MARKETPLACE_ID);
    assert.equal(official?.pluginCount, 1);
    assert.equal(official?.refreshFailure, undefined);
  } finally {
    if (previousMirrors === undefined) delete process.env[PLUGIN_MARKETPLACE_MIRRORS_ENV];
    else process.env[PLUGIN_MARKETPLACE_MIRRORS_ENV] = previousMirrors;
    await rm(storageRoot, { recursive: true, force: true });
  }
});
