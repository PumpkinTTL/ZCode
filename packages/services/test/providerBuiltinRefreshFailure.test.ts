import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountProviderService, ProviderConfigMap } from "@zcode/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderConfigRuntime } from "#src/model-provider/providerConfigRuntime.js";
import { createProviderRuntimeFromConfigRuntime } from "#src/model-provider/providerRuntime.js";

/**
 * 红线（v3.16.2 合并收口）：官方套餐账号型 Provider（account:zai-、account:bigmodel- 系列，
 * Team/Start 权益）已按砍除语义从 Built-in 目录移除；Resolver 只投影 Built-in 声明过的
 * Account Overlay，账号权益不再进入 Registry 投影。原「远端失败不阻断 Team/Start 权益
 * 刷新」的用例族随之失去被测语义，已删；本文件只保留与账号无关的本地 Release 健壮性约束。
 */
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "builtin-refresh-failure-"));
  const bundled = join(root, "bundled.json");
  const activePath = join(root, "active.json");
  const release = JSON.parse(
    await readFile(new URL("../../../config/provider/zcode-builtin.json", import.meta.url), "utf8"),
  );
  release.revision = 1;
  await writeFile(bundled, JSON.stringify(release));
  const download = vi.fn(async () => null);
  const configRuntime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: bundled,
    zcodeBuiltinActiveFilePath: activePath,
    personalFilePath: join(root, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
    zcodeBuiltinRemote: {
      controlFilePath: join(root, "refresh.json"),
      resolveEndpointKey: () => "https://control.example.com",
      fetchRelease: download,
    },
  });
  const account = new AccountProviderService({
    configSource: configRuntime.configService,
    resolve: async () => ({
      providers: ProviderConfigMap.empty(),
      states: {},
    }),
  });
  const runtime = createProviderRuntimeFromConfigRuntime({
    configRuntime,
    accountSource: account,
    disposeAccountSource: () => account.dispose(),
  });
  cleanups.push(async () => {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.start();
  return { runtime, configRuntime, bundled, activePath, download };
}

describe("Builtin 远端失败时的本地 Release 健壮性", () => {
  it("本地 Bundled 与 Active 都不可用时，仍拒绝刷新", async () => {
    const fixture = await setup();
    await writeFile(fixture.bundled, "invalid json");
    await writeFile(fixture.activePath, "invalid json");
    fixture.download.mockRejectedValue(new Error("remote unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fixture.runtime.providerSettings.refresh("settings-manual"),
    ).rejects.toThrow();
  });
});
