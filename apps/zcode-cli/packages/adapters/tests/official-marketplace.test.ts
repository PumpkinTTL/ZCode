import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeBundledOfficialMarketplacePartitionSync,
  writeCdnOfficialMarketplacePartitionSync,
  updateMarketplace,
} from "../src/plugins/index.js";

describe("Polaris official marketplace partitions", () => {
  const OFFICIAL_ID = "polaris-plugins-official";
  // 历史市场名：Z.ai 原站镜像至今以此名声明 manifest，只能作为输入，落盘必须归一化为本地官方 id。
  const LEGACY_CDN_ID = "zcode-plugins-official";
  const cleanups: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  async function makeStorageRoot(): Promise<string> {
    const storageRoot = await mkdtemp(join(tmpdir(), "polaris-official-marketplace-"));
    cleanups.push(storageRoot);
    return storageRoot;
  }

  it("merges bundled and CDN entries under one marketplace with CDN entries taking precedence", async () => {
    const storageRoot = await makeStorageRoot();

    writeBundledOfficialMarketplacePartitionSync({
      manifest: {
        name: OFFICIAL_ID,
        plugins: [
          { name: "shared", source: "filesystem", version: "1.0.0" },
          { name: "bundled-only", source: "filesystem", version: "1.0.0" },
        ],
        version: 1,
      },
      storageRoot,
    });
    writeCdnOfficialMarketplacePartitionSync({
      manifest: {
        name: LEGACY_CDN_ID,
        featured: ["remote"],
        plugins: [
          { name: "shared", source: { source: "url", type: "zip" }, version: "9.0.0" },
          { name: "remote", source: { source: "url", type: "zip" }, version: "2.0.0" },
        ],
      },
      storageRoot,
    });

    const merged = JSON.parse(
      await readFile(join(storageRoot, "marketplaces", OFFICIAL_ID, "marketplace.json"), "utf8"),
    ) as { featured?: string[]; name: string; plugins: Array<Record<string, unknown>> };
    expect(merged.name).toBe(OFFICIAL_ID);
    expect(merged.featured).toEqual(["remote"]);
    expect(merged.plugins.map((plugin) => plugin.name)).toEqual([
      "shared",
      "remote",
      "bundled-only",
    ]);
    expect(merged.plugins[0]).toMatchObject({
      source: { source: "url", type: "zip" },
      version: "9.0.0",
    });
  });

  it("preserves the CDN partition when the application reseeds bundled plugins", async () => {
    const storageRoot = await makeStorageRoot();

    writeCdnOfficialMarketplacePartitionSync({
      manifest: {
        name: LEGACY_CDN_ID,
        plugins: [{ name: "remote", source: { source: "url", type: "zip" } }],
      },
      storageRoot,
    });
    writeBundledOfficialMarketplacePartitionSync({
      manifest: {
        name: OFFICIAL_ID,
        plugins: [{ name: "bundled-v2", source: "sea", version: "2.0.0" }],
        version: 1,
      },
      storageRoot,
    });

    const merged = JSON.parse(
      await readFile(join(storageRoot, "marketplaces", OFFICIAL_ID, "marketplace.json"), "utf8"),
    ) as { plugins: Array<{ name: string }> };
    expect(merged.plugins.map((plugin) => plugin.name)).toEqual(["remote", "bundled-v2"]);
  });

  it("does not rewrite unchanged official marketplace files", async () => {
    const storageRoot = await makeStorageRoot();
    const bundledManifest = {
      name: OFFICIAL_ID,
      plugins: [{ name: "bundled", source: "filesystem", version: "1.0.0" }],
    };
    const cdnManifest = {
      name: LEGACY_CDN_ID,
      plugins: [{ name: "remote", source: { source: "url", type: "zip" } }],
    };
    const marketplaceRoot = join(storageRoot, "marketplaces", OFFICIAL_ID);

    writeBundledOfficialMarketplacePartitionSync({
      manifest: bundledManifest,
      storageRoot,
    });
    writeCdnOfficialMarketplacePartitionSync({
      manifest: cdnManifest,
      storageRoot,
    });
    const paths = [
      join(marketplaceRoot, "bundled-marketplace.json"),
      join(marketplaceRoot, "cdn-marketplace.json"),
      join(marketplaceRoot, "marketplace.json"),
    ];
    const firstMtimes = await Promise.all(paths.map(async (path) => (await stat(path)).mtimeMs));
    await delay(30);

    writeBundledOfficialMarketplacePartitionSync({
      manifest: bundledManifest,
      storageRoot,
    });
    writeCdnOfficialMarketplacePartitionSync({
      manifest: cdnManifest,
      storageRoot,
    });

    expect(await Promise.all(paths.map(async (path) => (await stat(path)).mtimeMs))).toEqual(
      firstMtimes,
    );
  });

  it("normalizes a retired CDN marketplace id instead of creating a compatibility alias", async () => {
    const storageRoot = await makeStorageRoot();

    const persisted = writeCdnOfficialMarketplacePartitionSync({
      manifest: { name: "zcode-plugins", plugins: [] },
      storageRoot,
    });
    // 镜像只贡献内容：远端声明的历史/第三方名不得成为落盘身份，本地官方 id 才是权威。
    expect(persisted.name).toBe(OFFICIAL_ID);
    const stored = JSON.parse(
      await readFile(join(storageRoot, "marketplaces", OFFICIAL_ID, "cdn-marketplace.json"), "utf8"),
    ) as { name: string };
    expect(stored.name).toBe(OFFICIAL_ID);
  });

  it("refreshes the registered official source and returns the merged plugin count", async () => {
    const storageRoot = await makeStorageRoot();
    writeBundledOfficialMarketplacePartitionSync({
      manifest: {
        name: OFFICIAL_ID,
        plugins: [{ name: "bundled", source: "filesystem" }],
      },
      storageRoot,
    });

    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name: LEGACY_CDN_ID,
          plugins: [{ name: "remote", source: { source: "url", type: "zip" } }],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server address missing");
      await writeFile(
        join(storageRoot, "known_marketplaces.json"),
        JSON.stringify({
          version: 1,
          marketplaces: [
            {
              // 存量配置可能仍记录历史官方 id；受信任刷新必须接受并把落盘 id 归一化。
              id: LEGACY_CDN_ID,
              source: { source: "url", url: `http://127.0.0.1:${address.port}/marketplace.json` },
              name: LEGACY_CDN_ID,
              addedAt: "2026-01-01T00:00:00.000Z",
              pluginCount: 1,
            },
          ],
        }),
      );

      const [updated] = await updateMarketplace({
        marketplace: LEGACY_CDN_ID,
        storageRoot,
      });
      expect(updated).toMatchObject({
        id: OFFICIAL_ID,
        pluginCount: 2,
      });

      const merged = JSON.parse(
        await readFile(join(storageRoot, "marketplaces", OFFICIAL_ID, "marketplace.json"), "utf8"),
      ) as { plugins: Array<{ name: string }> };
      expect(merged.plugins.map((plugin) => plugin.name)).toEqual(["remote", "bundled"]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
