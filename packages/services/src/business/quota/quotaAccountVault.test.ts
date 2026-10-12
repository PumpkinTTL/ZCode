/**
 * 账号级凭据档案回归（vitest，零网络）：多账号共机的「切号零 churn」闭环——
 *   1. 首登建档案：设备注册 → 认领创建 → 明文按账号入凭证库 + accounts 引用；
 *   2. 同账号重复登录：仅 1 次清单请求，零注册/零吊销/零重建；
 *   3. A⇄B⇄A：B 失配自愈重注册；回 A 只换指针 + 档案明文复用（零额外出网）；
 *   4. 前缀不匹配（key 在别处更换）→ 吊销 + 重建（最后手段）并重写档案；
 *   5. 升级迁移：无账号凭据时 legacy 单槽兜底复用，并迁移入账号档案；
 *   6. 无账号键（未登录态旧凭据）：退化为单账号行为，不写档案。
 */
import { describe, expect, it } from "vitest";
import type { ICredentialService } from "../../credential/credential.js";
import { createNodeNimbusDeviceKeyProvider } from "./nimbusDeviceIdentity.js";
import { createQuotaService } from "./quotaService.js";
import {
  NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX,
  NIMBUS_AGENT_KEY_CREDENTIAL_KEY,
  NIMBUS_DEVICE_CREDENTIAL_KEY,
  QUOTA_TOKEN_CREDENTIAL_KEY,
  QUOTA_USERNAME_CREDENTIAL_KEY,
} from "./quota.js";

// ------------------------------------------------------------
// 测试基建
// ------------------------------------------------------------

/** 内存凭证服务（等价 ICredentialService 契约；生产实现是加密 + 文件锁） */
function memoryCredentials(): ICredentialService & { dump(): Map<string, string> } {
  const store = new Map<string, string>();
  return {
    load: async (key) => store.get(key) ?? null,
    save: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    dump: () => store,
  };
}

/** 按脚本逐请求应答的 mock fetch（记录全部请求） */
function mockFetch(script: Array<{ status: number; body?: unknown }>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...script];
  const fetchImpl = (async (input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init: (init ?? {}) as RequestInit });
    const outcome = queue.shift() ?? { status: 500, body: { detail: "mock 队列耗尽" } };
    return new Response(outcome.body === undefined ? "" : JSON.stringify(outcome.body), {
      status: outcome.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

interface Harness {
  credentials: ICredentialService & { dump(): Map<string, string> };
  service: ReturnType<typeof createQuotaService>;
  calls: Array<{ url: string; init: RequestInit }>;
}

/** 装配：内存凭证 + 真实现设备身份（真实 Ed25519，仅凭证落内存）+ 脚本 fetch */
function harness(script: Array<{ status: number; body?: unknown }>): Harness {
  const credentials = memoryCredentials();
  const { fetchImpl, calls } = mockFetch(script);
  const deviceKeys = createNodeNimbusDeviceKeyProvider({ credentialService: credentials });
  const service = createQuotaService({
    credentialService: credentials,
    deviceKeys,
    baseUrl: "https://x.test",
    fetchImpl,
  });
  return { credentials, service, calls };
}

/** 会话种子：模拟一次登录落下的 token + 用户名（ensureApiKey 的账号键来源） */
async function seedSession(
  credentials: ICredentialService,
  username: string,
): Promise<void> {
  await credentials.save(QUOTA_TOKEN_CREDENTIAL_KEY, `jwt-${username}`);
  await credentials.save(QUOTA_USERNAME_CREDENTIAL_KEY, username);
}

interface DeviceIdentityShape {
  device_id?: string;
  accounts?: Record<string, { device_id?: string; key_id?: unknown; key_prefix?: unknown }>;
}

function deviceIdentityJson(
  credentials: ICredentialService & { dump(): Map<string, string> },
): DeviceIdentityShape {
  const raw = credentials.dump().get(NIMBUS_DEVICE_CREDENTIAL_KEY) ?? "{}";
  return JSON.parse(raw) as DeviceIdentityShape;
}

const FIRST_LOGIN_SCRIPT = [
  { status: 200, body: { id: 300 } }, // POST /user/devices/register（回执兼容 {id} 形态）
  { status: 200, body: { items: [] } }, // GET /user/keys
  { status: 200, body: { key: "sk-A1234567full", id: 1 } }, // POST /user/keys 创建
];

describe("ensureApiKey 账号级凭据档案（多账号：切号零 churn）", () => {
  it("首登（无档案未配对）：注册 → 创建 → 明文按账号入凭证库 + accounts 引用", async () => {
    const h = harness(FIRST_LOGIN_SCRIPT);
    await seedSession(h.credentials, "A");

    const apiKey = await h.service.ensureApiKey();

    expect(apiKey).toBe("sk-A1234567full");
    expect(h.calls.length).toBe(3);
    expect(h.calls[0]?.url).toBe("https://x.test/api/v1/user/devices/register");
    // 明文双落：账号键（供切号复用）+ legacy 单槽（最后使用语义/迁移兜底）
    expect(h.credentials.dump().get(NIMBUS_AGENT_KEY_CREDENTIAL_KEY)).toBe("sk-A1234567full");
    expect(h.credentials.dump().get(`${NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX}a`)).toBe(
      "sk-A1234567full",
    );
    // 账号档案引用
    const identity = deviceIdentityJson(h.credentials);
    expect(identity.device_id).toBe("300");
    expect(identity.accounts?.["a"]?.device_id).toBe("300");
  });

  it("同账号重复登录：零注册/零吊销/零重建，账号明文直取（仅 1 次出网）", async () => {
    const h1 = harness(FIRST_LOGIN_SCRIPT);
    await seedSession(h1.credentials, "A");
    await h1.service.ensureApiKey();

    // 第二次登录：复用同一凭证存储，只发一次清单请求
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { items: [{ id: 1, status: "active", key_prefix: "sk-A1234****" }] } },
    ]);
    const service2 = createQuotaService({
      credentialService: h1.credentials,
      deviceKeys: createNodeNimbusDeviceKeyProvider({ credentialService: h1.credentials }),
      baseUrl: "https://x.test",
      fetchImpl,
    });
    const apiKey = await service2.ensureApiKey();

    expect(apiKey).toBe("sk-A1234567full");
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain("/api/v1/user/keys?client_id=polaris&device_id=300");
  });

  it("A⇄B⇄A：B 失配自愈重注册；回 A 只换指针 + 档案明文复用（零额外出网）", async () => {
    const h = harness(FIRST_LOGIN_SCRIPT);
    await seedSession(h.credentials, "A");
    expect(await h.service.ensureApiKey()).toBe("sk-A1234567full");

    // 切 B：旧设备(300) 属 A → 404 → 同公钥在 B 名下重注册 → 认领创建
    await seedSession(h.credentials, "B");
    const bRun = mockFetch([
      { status: 200, body: { items: [] } }, // GET（设备 300，B 账号下空）
      { status: 404, body: { detail: "设备不存在" } }, // POST 创建 → 失配
      { status: 200, body: { device_id: "700" } }, // 同公钥重注册
      { status: 200, body: { items: [] } }, // GET（设备 700）
      { status: 200, body: { key: "sk-B1234567full", id: 2 } }, // POST 创建
    ]);
    const serviceB = createQuotaService({
      credentialService: h.credentials,
      deviceKeys: createNodeNimbusDeviceKeyProvider({ credentialService: h.credentials }),
      baseUrl: "https://x.test",
      fetchImpl: bRun.fetchImpl,
    });
    expect(await serviceB.ensureApiKey()).toBe("sk-B1234567full");
    expect(bRun.calls.length).toBe(5);
    const afterB = deviceIdentityJson(h.credentials);
    expect(afterB.accounts?.["a"]?.device_id).toBe("300"); // A 档案原样保留
    expect(afterB.accounts?.["b"]?.device_id).toBe("700");

    // 切回 A：档案设备定位 + 明文直取 —— 只发 1 次清单请求
    await seedSession(h.credentials, "A");
    const aRun = mockFetch([
      { status: 200, body: { items: [{ id: 1, status: "active", key_prefix: "sk-A1234****" }] } },
    ]);
    const serviceA = createQuotaService({
      credentialService: h.credentials,
      deviceKeys: createNodeNimbusDeviceKeyProvider({ credentialService: h.credentials }),
      baseUrl: "https://x.test",
      fetchImpl: aRun.fetchImpl,
    });
    expect(await serviceA.ensureApiKey()).toBe("sk-A1234567full");
    expect(aRun.calls.length).toBe(1);
    expect(aRun.calls[0]?.url).toContain("device_id=300");
    // 指针已切回 A 的设备（写回身份）
    expect(deviceIdentityJson(h.credentials).device_id).toBe("300");
  });

  it("账号明文前缀不匹配（key 在别处更换）→ 吊销 + 重建（最后手段）并重写档案", async () => {
    const h = harness(FIRST_LOGIN_SCRIPT);
    await seedSession(h.credentials, "A");
    await h.service.ensureApiKey();
    // 模拟 key 在别处被更换：账号明文与旧 key 前缀都对不上服务端现役
    await h.credentials.save(`${NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX}a`, "sk-OLD123456old");

    const run = mockFetch([
      { status: 200, body: { items: [{ id: 1, status: "active", key_prefix: "sk-NEW123****" }] } },
      { status: 200, body: {} }, // DELETE 旧 key
      { status: 200, body: { key: "sk-NEW1234567new", id: 2 } }, // POST 重建
    ]);
    const service = createQuotaService({
      credentialService: h.credentials,
      deviceKeys: createNodeNimbusDeviceKeyProvider({ credentialService: h.credentials }),
      baseUrl: "https://x.test",
      fetchImpl: run.fetchImpl,
    });
    expect(await service.ensureApiKey()).toBe("sk-NEW1234567new");
    expect(run.calls.length).toBe(3);
    expect(run.calls[1]?.url).toBe("https://x.test/api/v1/user/keys/1");
    expect(run.calls[1]?.init.method).toBe("DELETE");
    // 档案与明文同步重写
    expect(h.credentials.dump().get(`${NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX}a`)).toBe(
      "sk-NEW1234567new",
    );
    expect(deviceIdentityJson(h.credentials).accounts?.["a"]?.key_id).toBe(2);
  });

  it("升级迁移：无账号凭据时 legacy 单槽前缀校验复用，并迁移入账号档案", async () => {
    const h = harness(FIRST_LOGIN_SCRIPT);
    await seedSession(h.credentials, "A");
    await h.service.ensureApiKey();

    // 回退成升级前形态：删账号明文明细与 accounts 引用，只留 legacy 单槽
    const identity = deviceIdentityJson(h.credentials) as Record<string, unknown>;
    delete identity.accounts;
    await h.credentials.save(NIMBUS_DEVICE_CREDENTIAL_KEY, JSON.stringify(identity));
    await h.credentials.delete(`${NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX}a`);

    const run = mockFetch([
      { status: 200, body: { items: [{ id: 1, status: "active", key_prefix: "sk-A1234****" }] } },
    ]);
    const service = createQuotaService({
      credentialService: h.credentials,
      deviceKeys: createNodeNimbusDeviceKeyProvider({ credentialService: h.credentials }),
      baseUrl: "https://x.test",
      fetchImpl: run.fetchImpl,
    });
    expect(await service.ensureApiKey()).toBe("sk-A1234567full");
    expect(run.calls.length).toBe(1); // legacy 复用，无吊销/重建
    // 迁移落档：账号明文 + accounts 引用补齐
    expect(h.credentials.dump().get(`${NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX}a`)).toBe(
      "sk-A1234567full",
    );
    expect(deviceIdentityJson(h.credentials).accounts?.["a"]?.device_id).toBe("300");
  });

  it("无账号键（未登录态旧凭据）：退化为单账号行为，不写账号档案", async () => {
    const h = harness(FIRST_LOGIN_SCRIPT);
    await h.credentials.save(QUOTA_TOKEN_CREDENTIAL_KEY, "jwt-legacy");
    // 故意不写用户名（旧凭据形态）

    expect(await h.service.ensureApiKey()).toBe("sk-A1234567full");
    expect(h.credentials.dump().get(NIMBUS_AGENT_KEY_CREDENTIAL_KEY)).toBe("sk-A1234567full");
    expect(h.credentials.dump().get(`${NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX}a`)).toBeUndefined();
    expect(deviceIdentityJson(h.credentials).accounts).toBeUndefined();
  });
});
