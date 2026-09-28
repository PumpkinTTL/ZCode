import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addMarketplace,
  installMarketplacePlugin,
  listInstalledPluginRecords,
} from "../src/plugins/marketplace.js";

const MARKETPLACE_ID = "staging-weight-fixture";
const PLUGIN_NAME = "example-plugin";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** 造一个本地市场：清单 + 一个相对路径引用的插件（带可观的 payload）。 */
async function createMarketplaceFixture(root: string): Promise<void> {
  await writeJson(join(root, ".claude-plugin", "marketplace.json"), {
    name: MARKETPLACE_ID,
    plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}` }],
  });
  const pluginRoot = join(root, "plugins", PLUGIN_NAME);
  await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
    name: PLUGIN_NAME,
    version: "1.0.0",
  });
  await writeFile(join(pluginRoot, "payload.bin"), "x".repeat(4096));
}

/**
 * 添加市场不再复制源树：无论清单里有没有相对路径条目，本地只落 marketplace.json。
 * 否则添加一个 300+ 插件的公开目录会把整个仓库再复制一份到插件目录。
 */
test("adding a marketplace stages only the manifest, never the source tree", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "polaris-staging-light-"));
  try {
    const sourceDir = join(workspace, "source");
    await createMarketplaceFixture(sourceDir);

    const storageRoot = join(workspace, "storage");
    await addMarketplace({ source: { source: "directory", path: sourceDir }, storageRoot });

    const staged = await readdir(join(storageRoot, "marketplaces", MARKETPLACE_ID));
    assert.deepEqual(staged, ["marketplace.json"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

/**
 * 相对路径条目改为“安装时按需物化”：即使添加时没落源树，安装仍必须成功，
 * 并把该插件的内容拷进插件缓存。
 */
test("installing a relative-source plugin materializes the source on demand", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "polaris-staging-heavy-"));
  try {
    const sourceDir = join(workspace, "source");
    await createMarketplaceFixture(sourceDir);

    const storageRoot = join(workspace, "storage");
    await addMarketplace({ source: { source: "directory", path: sourceDir }, storageRoot });

    const result = await installMarketplacePlugin({
      marketplace: MARKETPLACE_ID,
      name: PLUGIN_NAME,
      storageRoot,
    });

    const record = listInstalledPluginRecords(storageRoot).find(
      (item) => item.id === `${PLUGIN_NAME}@${MARKETPLACE_ID}`,
    );
    assert.ok(record, "plugin must be recorded as installed");
    assert.equal(result.installed.length, 1);
    const payload = await readFile(join(record.installPath, "payload.bin"), "utf8");
    assert.equal(payload.length, 4096);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

/**
 * 旧版本遗留的整棵源树会在下一次刷新时被原子替换掉，自动回收空间 —— 不需要用户手动移除再加。
 */
test("refreshing a legacy marketplace reclaims its staged source tree", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "polaris-staging-reclaim-"));
  try {
    const sourceDir = join(workspace, "source");
    await createMarketplaceFixture(sourceDir);

    const storageRoot = join(workspace, "storage");
    // 模拟旧版本留下的状态：市场目录里带一整棵源树。
    const legacyStaged = join(storageRoot, "marketplaces", MARKETPLACE_ID);
    await mkdir(join(legacyStaged, "plugins", PLUGIN_NAME), { recursive: true });
    await writeFile(join(legacyStaged, "plugins", PLUGIN_NAME, "payload.bin"), "x".repeat(4096));
    await writeJson(join(legacyStaged, "marketplace.json"), {
      name: MARKETPLACE_ID,
      plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}` }],
    });

    await addMarketplace({ source: { source: "directory", path: sourceDir }, storageRoot });

    const staged = await readdir(legacyStaged);
    assert.deepEqual(staged, ["marketplace.json"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
