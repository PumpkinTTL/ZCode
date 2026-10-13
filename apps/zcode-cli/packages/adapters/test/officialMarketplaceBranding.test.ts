import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION } from "@zcode/shared";
import {
  writeBundledOfficialMarketplacePartitionSync,
  writeCdnOfficialMarketplacePartitionSync,
} from "../src/plugins/official-marketplace.js";

const OFFICIAL_ID = "polaris-plugins-official";
const MERGED_PATH = join("marketplaces", OFFICIAL_ID, "marketplace.json");

describe("official marketplace branding", () => {
  /**
   * 去品牌红线：官方目录可以有多个镜像（Polaris 自有 + Z.ai 原站），但镜像只能贡献“内容”
   * （插件条目、featured 策展名单），绝不能把它自己的品牌字段写成本地官方目录的身份。
   * 否则 Z.ai 的 `owner` 与 "Official ZCode plugins marketplace" 文案会显示成我们自己的目录。
   */
  it("remote mirror branding never becomes the official marketplace identity", async () => {
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
      // Z.ai 原站 manifest 至今声明历史名：镜像路径必须归一化为本地官方 id 后再落盘。
      const LEGACY_ID = "zcode-plugins-official";
      const merged = writeCdnOfficialMarketplacePartitionSync({
        manifest: {
          name: LEGACY_ID,
          description:
            "Official ZCode plugins marketplace: built-in and community plugins for ZCode.",
          description_i18n: { "zh-CN": "ZCode 官方插件目录" },
          owner: { name: "Z.ai", url: "https://z.ai" },
          featured: ["cloudbase-skills"],
          plugins: [{ name: "cloudbase-skills" }],
        },
        storageRoot,
      });

      // 身份归 Polaris：镜像的品牌字段一个都不能带进来。
      expect("owner" in merged, "mirror owner must not leak").toBe(false);
      expect("description_i18n" in merged, "mirror localized description must not leak").toBe(
        false,
      );
      expect(merged.description).toBe(POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_DESCRIPTION);
      expect(merged.name).toBe(OFFICIAL_ID);

      // 内容仍然来自镜像：插件条目与策展名单照常合并。
      const names = (merged.plugins as Array<{ name: string }>).map((plugin) => plugin.name);
      expect(names).toEqual(["cloudbase-skills", "browser-use"]);
      expect(merged.featured).toEqual(["cloudbase-skills"]);

      // 落盘的规范 manifest 同样不能含厂商品牌，也不能残留历史市场名。
      const onDisk = await readFile(join(storageRoot, MERGED_PATH), "utf8");
      expect(onDisk.includes("Z.ai"), "persisted manifest must not contain vendor brand").toBe(
        false,
      );
      expect(onDisk.includes("Official ZCode plugins marketplace")).toBe(false);
      expect(
        onDisk.includes(LEGACY_ID),
        "legacy marketplace name must be normalized before persisting",
      ).toBe(false);
      expect(onDisk.includes(OFFICIAL_ID)).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
