/**
 * 在线心跳身份键回归（vitest，零网络）：双通道同键去重契约。
 *
 * cbcn-cloud 管理端在线数 = Redis 5 分钟窗口内活跃 identity 去重数
 * （app_release.py:52-102）。同一台机器有两条上报通道：
 *   - electron manifest（主进程 electron-updater，device_mid 参数）；
 *   - 独立心跳端点（host 进程定时 POST，device 字段）。
 * 两通道必须上报**同一字符串**，否则同设备双计。心跳侧优先级：
 * 主进程 deviceMid（与 manifest device_mid 同值）> Nimbus device id > 空串（后端回落 IP+UA）。
 */
import { describe, expect, it } from "vitest";
import type { NimbusDeviceKeyProvider } from "../quota/quota.js";
import { createAppUpdateService } from "./appUpdateService.js";

/** 按固定响应应答的 mock fetch（记录请求） */
function mockFetch(body: unknown = { ok: true }): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init: (init ?? {}) as RequestInit });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** 最小设备密钥 provider（只关心 loadOrCreate 回的 device id） */
function fakeDeviceKeys(deviceId: string | null): NimbusDeviceKeyProvider {
  return {
    loadOrCreate: async () => ({
      deviceId,
      publicKeyPem: "test-public",
      privateKeyPem: "test-private",
      keyId: null,
      keyPrefix: null,
    }),
    save: async () => {},
    createSigner: () => () => ({}),
    publicKeyRawBase64: () => "test-raw",
    deviceReport: () => ({ name: "test", platform: "windows", appVersion: "0.0.0" }),
  };
}

function heartbeatBody(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function harness(input: {
  deviceMid?: string;
  deviceKeys?: NimbusDeviceKeyProvider;
  latestBody?: unknown;
}) {
  const { fetchImpl, calls } = mockFetch(input.latestBody);
  const { service } = createAppUpdateService({
    appVersion: "1.0.1",
    platform: "windows",
    baseUrl: "https://x.test",
    deviceMid: input.deviceMid,
    deviceKeys: input.deviceKeys,
    fetchImpl,
  });
  return { service, calls };
}

describe("reportHeartbeat 身份键（双通道同键去重）", () => {
  it("deviceMid 优先：即使设备身份已配对（Nimbus device id 可用）也用 deviceMid 上报", async () => {
    const h = harness({
      deviceMid: "0f8c4f4e-aaaa-bbbb-cccc-ddddeeeeffff",
      deviceKeys: fakeDeviceKeys("9001"),
    });

    const ok = await h.service.reportHeartbeat();

    expect(ok).toBe(true);
    expect(h.calls.length).toBe(1);
    expect(h.calls[0]?.url).toBe("https://x.test/api/v1/app-updates/polaris/heartbeat");
    expect(heartbeatBody(h.calls[0]!)).toEqual({
      version: "1.0.1",
      device: "0f8c4f4e-aaaa-bbbb-cccc-ddddeeeeffff",
      platform: "windows",
    });
  });

  it("无 deviceMid（非桌面宿主）回落 Nimbus device id", async () => {
    const h = harness({ deviceKeys: fakeDeviceKeys("9001") });

    await h.service.reportHeartbeat();

    expect(heartbeatBody(h.calls[0]!)["device"]).toBe("9001");
  });

  it("deviceMid 为空白视同缺省，仍走回落链", async () => {
    const h = harness({ deviceMid: "   ", deviceKeys: fakeDeviceKeys("9001") });

    await h.service.reportHeartbeat();

    expect(heartbeatBody(h.calls[0]!)["device"]).toBe("9001");
  });

  it("两者都取不到：device 空串（后端按 IP+UA 哈希归属）", async () => {
    const h = harness({});

    await h.service.reportHeartbeat();

    expect(heartbeatBody(h.calls[0]!)["device"]).toBe("");
  });
});

describe("checkForUpdate 更新检查即心跳（app_release.py:200）", () => {
  it("latest 请求带上与独立心跳相同的 device——同机两条链不按两个身份双计", async () => {
    const h = harness({
      deviceMid: "0f8c4f4e-aaaa-bbbb-cccc-ddddeeeeffff",
      latestBody: { latest: { version: "1.0.1", file: {} } },
    });

    const check = await h.service.checkForUpdate();

    expect(check?.latest.version).toBe("1.0.1");
    const url = new URL(h.calls[0]!.url);
    expect(url.pathname).toBe("/api/v1/app-updates/polaris/latest");
    expect(url.searchParams.get("device")).toBe("0f8c4f4e-aaaa-bbbb-cccc-ddddeeeeffff");
    expect(url.searchParams.get("current_version")).toBe("1.0.1");
    expect(url.searchParams.get("platform")).toBe("windows");
  });

  it("无设备身份时不带 device 参数（后端照旧按 IP+UA 归属）", async () => {
    const h = harness({ latestBody: { latest: { version: "1.0.1", file: {} } } });

    await h.service.checkForUpdate();

    expect(new URL(h.calls[0]!.url).searchParams.has("device")).toBe(false);
  });
});
