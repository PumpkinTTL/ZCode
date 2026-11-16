import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as asyncFs from "node:fs/promises";
import * as pluginFiles from "../src/plugins/helpers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  writeBundledOfficialMarketplacePartition,
  writeCdnOfficialMarketplacePartition,
  updateMarketplace,
} from "../src/plugins/index.js";

<<<<<<< HEAD
describe("Polaris official marketplace partitions", () => {
  const OFFICIAL_ID = "polaris-plugins-official";
  // 历史市场名：Z.ai 原站镜像至今以此名声明 manifest，只能作为输入，落盘必须归一化为本地官方 id。
  const LEGACY_CDN_ID = "zcode-plugins-official";
=======
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    realpath: vi.fn(actual.realpath),
    rename: vi.fn(actual.rename),
  };
});
vi.mock("../src/plugins/helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/plugins/helpers.js")>();
  return { ...actual, writePluginTextIfChanged: vi.fn(actual.writePluginTextIfChanged) };
});

describe("ZCode official marketplace partitions", () => {
>>>>>>> upstream/main
  const cleanups: string[] = [];

  afterEach(async () => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("serializes bundled and CDN publication across asynchronous writes", async () => {
    const storageRoot = await makeStorageRoot();
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const actualFiles = await vi.importActual<typeof import("../src/plugins/helpers.js")>(
      "../src/plugins/helpers.js",
    );
    // 根已存在；让 admission 前的元数据步骤立即完成，以受控 Promise 决定 writer 顺序。
    vi.spyOn(asyncFs, "mkdir").mockImplementation(async (...args) =>
      args[0] === storageRoot ? undefined : actualFs.mkdir(...args),
    );
    vi.spyOn(asyncFs, "realpath").mockImplementation(async (...args) =>
      args[0] === storageRoot ? storageRoot : actualFs.realpath(...args),
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let cdnStarted = false;
    vi.spyOn(pluginFiles, "writePluginTextIfChanged").mockImplementation(async (path, contents) => {
      if (path.endsWith("bundled-marketplace.json")) {
        entered.resolve();
        await release.promise;
      }
      if (path.endsWith("cdn-marketplace.json")) cdnStarted = true;
      await actualFiles.writePluginTextIfChanged(path, contents);
    });
    const bundled = writeBundledOfficialMarketplacePartition({
      storageRoot,
      manifest: {
        name: "zcode-plugins-official",
        plugins: [{ name: "bundled", version: "1" }],
      },
    });
    await entered.promise;
    const cdn = writeCdnOfficialMarketplacePartition({
      storageRoot,
      manifest: {
        name: "zcode-plugins-official",
        plugins: [{ name: "cdn", version: "2" }],
      },
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cdnStarted).toBe(false);
    } finally {
      release.resolve();
      await Promise.all([bundled, cdn]);
    }
    const manifest = JSON.parse(
      await readFile(
        join(storageRoot, "marketplaces", "zcode-plugins-official", "marketplace.json"),
        "utf8",
      ),
    );
    expect(manifest.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      "cdn",
      "bundled",
    ]);
  });

  it("retries transient rename contention and preserves the previous file on persistent failure", async () => {
    const root = await makeStorageRoot();
    const path = join(root, "manifest.json");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    await writeFile(path, "old");
    const rename = vi
      .spyOn(asyncFs, "rename")
      .mockClear()
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EPERM" }));
    rename.mockImplementationOnce(actual.rename);
    await pluginFiles.writePluginTextIfChanged(path, "new");
    expect(rename).toHaveBeenCalledTimes(2);
    expect(await readFile(path, "utf8")).toBe("new");
    rename.mockRejectedValue(Object.assign(new Error("busy"), { code: "EACCES" }));
    await expect(pluginFiles.writePluginTextIfChanged(path, "incomplete")).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(await readFile(path, "utf8")).toBe("new");
    expect(await actual.readdir(root)).toEqual(["manifest.json"]);
  });

  async function makeStorageRoot(): Promise<string> {
    const storageRoot = await mkdtemp(join(tmpdir(), "polaris-official-marketplace-"));
    cleanups.push(storageRoot);
    return storageRoot;
  }

  it("merges bundled and CDN entries under one marketplace with CDN entries taking precedence", async () => {
    const storageRoot = await makeStorageRoot();

    await writeBundledOfficialMarketplacePartition({
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
    await writeCdnOfficialMarketplacePartition({
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

    await writeCdnOfficialMarketplacePartition({
      manifest: {
        name: LEGACY_CDN_ID,
        plugins: [{ name: "remote", source: { source: "url", type: "zip" } }],
      },
      storageRoot,
    });
    await writeBundledOfficialMarketplacePartition({
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

    await writeBundledOfficialMarketplacePartition({
      manifest: bundledManifest,
      storageRoot,
    });
    await writeCdnOfficialMarketplacePartition({
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

    await writeBundledOfficialMarketplacePartition({
      manifest: bundledManifest,
      storageRoot,
    });
    await writeCdnOfficialMarketplacePartition({
      manifest: cdnManifest,
      storageRoot,
    });

    expect(await Promise.all(paths.map(async (path) => (await stat(path)).mtimeMs))).toEqual(
      firstMtimes,
    );
  });

  it("normalizes a retired CDN marketplace id instead of creating a compatibility alias", async () => {
    const storageRoot = await makeStorageRoot();

<<<<<<< HEAD
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
=======
    await expect(
      (async () =>
        await writeCdnOfficialMarketplacePartition({
          manifest: { name: "zcode-plugins", plugins: [] },
          storageRoot,
        }))(),
    ).rejects.toThrow("Official marketplace manifest must be named zcode-plugins-official");
>>>>>>> upstream/main
  });

  it("refreshes the registered official source and returns the merged plugin count", async () => {
    const storageRoot = await makeStorageRoot();
    await writeBundledOfficialMarketplacePartition({
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
