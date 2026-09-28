import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDaemonServiceDescriptor,
  createServiceDescriptor,
  serviceDescriptorPath,
} from "../src/platform/serviceManager.js";
import { resolveServerLayout } from "../src/runtime/paths.js";
import {
  createRuntimeManifest,
  serverRuntimeManifestSchema,
  SERVER_RUNTIME_PRODUCT,
} from "../src/runtime/manifest.js";
import { writeStableLauncher } from "../src/runtime/stableLauncher.js";

const OWNED_SERVICE_NAME_PREFIX = "com.bitlesu.polaris.server";

async function withTempRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "polaris-server-identity-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("daemon service identity never leaks another vendor's name", async () => {
  await withTempRoot(async (root) => {
    const layout = resolveServerLayout(root);
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const descriptor = createDaemonServiceDescriptor({ platform, layout });
      assert.ok(
        descriptor.name.startsWith(OWNED_SERVICE_NAME_PREFIX),
        `${platform} service name must use our identity, received ${descriptor.name}`,
      );
      assert.ok(!descriptor.name.includes("zhipu"), `${platform} service name keeps vendor leak`);
      assert.ok(!descriptor.content.includes("zcode"), `${platform} descriptor keeps legacy name`);
      assert.ok(
        descriptor.content.includes("polaris"),
        `${platform} descriptor must reference the Polaris launcher`,
      );
      // 描述符文件按服务名落盘；旧名文件不会被覆盖，注册前由 root-scoped 清理收口。
      assert.ok(
        serviceDescriptorPath(layout, descriptor).includes(OWNED_SERVICE_NAME_PREFIX),
        `${platform} descriptor path must follow the service name`,
      );
    }
  });
});

test("explicitly created descriptors default to our identity", () => {
  const descriptor = createServiceDescriptor({ platform: "linux", command: "/opt/polaris" });
  assert.equal(descriptor.name, OWNED_SERVICE_NAME_PREFIX);
  assert.ok(descriptor.content.includes("Description=Polaris Server"));
});

test("stable launcher is written as polaris and removes the legacy entrypoint", async () => {
  await withTempRoot(async (root) => {
    const layout = resolveServerLayout(root);
    await mkdir(layout.stableBinDir, { recursive: true });

    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "darwin"
          ? "darwin"
          : "linux";
    const launcherName = platform === "win32" ? "polaris.cmd" : "polaris";
    const legacyName = platform === "win32" ? "zcode.cmd" : "zcode";
    const legacyPath = join(layout.stableBinDir, legacyName);
    await writeFile(legacyPath, "legacy", "utf8");

    const launcherPath = await writeStableLauncher(layout, platform);
    assert.equal(launcherPath, join(layout.stableBinDir, launcherName));
    assert.ok(existsSync(launcherPath));
    assert.ok(!existsSync(legacyPath), "legacy launcher must be cleaned up");
    const content = await readFile(launcherPath, "utf8");
    assert.ok(content.includes("Polaris Server"), "launcher failure messages must be self-branded");
    assert.ok(!content.includes("ZCode"), "launcher must not surface the legacy product name");
  });
});

test("runtime manifest writes our product and still parses legacy installs", () => {
  const manifest = createRuntimeManifest("linux-x64", "1.2.3");
  assert.equal(manifest.product, SERVER_RUNTIME_PRODUCT);
  assert.equal(serverRuntimeManifestSchema.parse(manifest).product, SERVER_RUNTIME_PRODUCT);
  // 已装机契约：老远端服务器写的是 zcode-server，读侧必须继续接受，否则升级即判非法。
  const legacy = { ...manifest, product: "zcode-server" };
  assert.equal(serverRuntimeManifestSchema.parse(legacy).product, "zcode-server");
});
