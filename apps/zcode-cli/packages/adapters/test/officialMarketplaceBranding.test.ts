import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION } from "@zcode/shared";
import {
  writeBundledOfficialMarketplacePartitionSync,
  writeCdnOfficialMarketplacePartitionSync,
} from "../src/plugins/official-marketplace.js";

const OFFICIAL_ID = "zcode-plugins-official";
const MERGED_PATH = join("marketplaces", OFFICIAL_ID, "marketplace.json");

/**
 * 去品牌红线：官方目录可以有多个镜像（Polaris 自有 + Z.ai 原站），但镜像只能贡献“内容”
 * （插件条目、featured 策展名单），绝不能把它自己的品牌字段写成本地官方目录的身份。
 * 否则 Z.ai 的 `owner` 与 "Official ZCode plugins marketplace" 文案会显示成我们自己的目录。
 */
test("remote mirror branding never becomes the official marketplace identity", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "polaris-official-branding-"));
  try {
    writeBundledOfficialMarketplacePartitionSync({
      manifest: {
        name: OFFICIAL_ID,
        description: POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION,
        plugins: [{ name: "browser-use" }],
      },
      storageRoot,
    });
    const merged = writeCdnOfficialMarketplacePartitionSync({
      manifest: {
        name: OFFICIAL_ID,
        description: "Official ZCode plugins marketplace: built-in and community plugins for ZCode.",
        description_i18n: { "zh-CN": "ZCode 官方插件目录" },
        owner: { name: "Z.ai", url: "https://z.ai" },
        featured: ["cloudbase-skills"],
        plugins: [{ name: "cloudbase-skills" }],
      },
      storageRoot,
    });

    // 身份归 Polaris：镜像的品牌字段一个都不能带进来。
    assert.equal("owner" in merged, false, "mirror owner must not leak");
    assert.equal("description_i18n" in merged, false, "mirror localized description must not leak");
    assert.equal(merged.description, POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION);
    assert.equal(merged.name, OFFICIAL_ID);

    // 内容仍然来自镜像：插件条目与策展名单照常合并。
    const names = (merged.plugins as Array<{ name: string }>).map((plugin) => plugin.name);
    assert.deepEqual(names, ["cloudbase-skills", "browser-use"]);
    assert.deepEqual(merged.featured, ["cloudbase-skills"]);

    // 落盘的规范 manifest 同样不能含厂商品牌。
    const onDisk = await readFile(join(storageRoot, MERGED_PATH), "utf8");
    assert.equal(onDisk.includes("Z.ai"), false, "persisted manifest must not contain vendor brand");
    assert.equal(onDisk.includes("Official ZCode plugins marketplace"), false);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
