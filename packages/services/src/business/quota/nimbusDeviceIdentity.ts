/**
 * Nimbus 设备身份 · Ed25519 密钥对 + 请求签名（node 专用，不进渲染层导出图）。
 *
 * 与 Lyra 的 device-identity.ts / request-signing.ts 同一服务端契约（cbcn-cloud
 * app/core/proxy/agent_signature.py 冻结口径，二期实现前不得单方面更改）：
 *   请求头（两个）：
 *     X-Lyra-Device:    devices.id（十进制字符串；注册前无 id，填非空占位 "0"）
 *     X-Lyra-Signature: "t=<unix秒>,v=<base64(Ed25519签名)>"
 *   签名串（UTF-8，\n 连四段）：{timestamp}\n{METHOD}\n{path}\n{sha256_hex(body)}
 *     path 不含 query；body 无请求体 = 空串摘要；|now-t| ≤ 60s。
 *
 * 本文件只被宿主组合根（services/src/node.ts）实例化并注入 quotaService；
 * quotaService 只 `import type`，渲染层 bundle 不会引入 node:crypto。
 *
 * 身份存储：整个身份（含私钥 PEM）作为一个 JSON 塞进 ICredentialService ——
 * 与登录 token 同一加密存储边界，等价于 Lyra 的 safeStorage 封存方案。
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { hostname } from "node:os";
import type { ICredentialService } from "../../credential/credential.js";
import {
  NIMBUS_CLIENT_ID,
  NIMBUS_DEVICE_CREDENTIAL_KEY,
  type NimbusAccountKeyRef,
  type NimbusDeviceIdentity,
  type NimbusDeviceKeyProvider,
} from "./quota.js";

/** 一次待签名请求的描述（pathWithQuery 含 query 也可以——签名串只取 path 段）。 */
export interface NimbusSignDescriptor {
  readonly method: string;
  readonly pathWithQuery: string;
  readonly body: string | null;
}

/** 请求签名器：返回直接并进 fetch headers 的头集合。 */
export type NimbusRequestSigner = (descriptor: NimbusSignDescriptor) => Record<string, string>;

const DEVICE_FILE_VERSION = 1;

/** body → sha256 hex（小写）；null 视为空串（服务端同式复算）。 */
function sha256HexOfBody(body: string | null): string {
  return createHash("sha256").update(body ?? "", "utf8").digest("hex");
}

/** pathWithQuery → 签名用 path（不含 query；与 request.url.path 同口径）。 */
function pathnameOf(pathWithQuery: string): string {
  const q = pathWithQuery.indexOf("?");
  return q === -1 ? pathWithQuery : pathWithQuery.slice(0, q);
}

/** 待签名规范串：`timestamp\nMETHOD\npath\nbodySha256`（改动即破坏服务端兼容）。 */
export function buildSigningPayload(
  timestampSec: number,
  method: string,
  path: string,
  bodySha256: string,
): string {
  return `${timestampSec}\n${method.toUpperCase()}\n${pathnameOf(path)}\n${bodySha256}`;
}

/** Ed25519 请求签名头（冻结契约：两头、t=,v=、path 不含 query、±60s 窗）。 */
export function signNimbusRequest(
  privateKeyPem: string,
  deviceId: string,
  input: NimbusSignDescriptor,
): Record<string, string> {
  const timestampSec = Math.floor(Date.now() / 1000);
  const payload = buildSigningPayload(
    timestampSec,
    input.method,
    input.pathWithQuery,
    sha256HexOfBody(input.body),
  );
  const signature = cryptoSign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem));
  return {
    "x-lyra-device": deviceId,
    "x-lyra-signature": `t=${timestampSec},v=${signature.toString("base64")}`,
  };
}

/**
 * SPKI PEM → base64 裸 32 字节公钥。Ed25519 的 SPKI DER 固定 44 字节、
 * 尾部 32 字节即裸公钥（服务端解码后须恰 32 字节，不收 PEM）。
 */
export function ed25519PublicPemToBase64Raw(pem: string): string {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  if (der.length < 32) throw new Error("设备公钥 DER 长度异常，无法上送注册");
  return der.subarray(der.length - 32).toString("base64");
}

/** 磁盘（凭证存储）身份 JSON 的内存形态；形状不对返回 null（触发重新配对）。 */
function parseIdentityJson(raw: string | null): NimbusDeviceIdentity | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.client_id !== NIMBUS_CLIENT_ID) return null;
  const publicKeyPem = typeof rec.public_key === "string" ? rec.public_key : "";
  const privateKeyPem = typeof rec.private_key === "string" ? rec.private_key : "";
  if (!publicKeyPem || !privateKeyPem) return null;
  const deviceId = typeof rec.device_id === "string" && rec.device_id ? rec.device_id : null;
  const keyId =
    (typeof rec.key_id === "string" && rec.key_id) ||
    (typeof rec.key_id === "number" ? rec.key_id : null);
  const keyPrefix = typeof rec.key_prefix === "string" && rec.key_prefix ? rec.key_prefix : null;
  const accounts = parseAccountRefs(rec.accounts);
  return {
    deviceId,
    publicKeyPem,
    privateKeyPem,
    keyId,
    keyPrefix,
    ...(accounts ? { accounts } : {}),
  };
}

/**
 * accounts 映射容错解析（多账号凭据档案）：缺 device_id 的条目一律丢弃——
 * 坏一条不拖垮整份身份（文件是自产自销的，出现坏形状按无该条目处理即可）。
 */
function parseAccountRefs(
  raw: unknown,
): Record<string, NimbusAccountKeyRef> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, NimbusAccountKeyRef> = {};
  for (const [accountKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!accountKey || typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const rec = value as Record<string, unknown>;
    const deviceId = typeof rec.device_id === "string" && rec.device_id ? rec.device_id : null;
    if (!deviceId) continue;
    const keyId =
      (typeof rec.key_id === "string" && rec.key_id) ||
      (typeof rec.key_id === "number" ? rec.key_id : null);
    const keyPrefix = typeof rec.key_prefix === "string" && rec.key_prefix ? rec.key_prefix : null;
    out[accountKey] = { deviceId, keyId, keyPrefix };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 宿主生产实现：身份整个存凭证服务（与 token 同边界）；密钥对用 node:crypto Ed25519。
 * appVersion 缺省 "dev"（组合根有应用版本时传入，仅用于设备列表展示）。
 */
export function createNodeNimbusDeviceKeyProvider(options: {
  readonly credentialService: ICredentialService;
  readonly appVersion?: string;
}): NimbusDeviceKeyProvider {
  const { credentialService } = options;

  async function loadOrCreate(): Promise<NimbusDeviceIdentity> {
    const existing = parseIdentityJson(await credentialService.load(NIMBUS_DEVICE_CREDENTIAL_KEY));
    if (existing) return existing;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const identity: NimbusDeviceIdentity = {
      deviceId: null,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      keyId: null,
      keyPrefix: null,
    };
    // 立即落盘：注册失败不丢密钥对，下次用同一公钥重试（服务端幂等识别）。
    await save(identity);
    return identity;
  }

  async function save(identity: NimbusDeviceIdentity): Promise<void> {
    const accounts: Record<string, Record<string, unknown>> = {};
    for (const [accountKey, ref] of Object.entries(identity.accounts ?? {})) {
      accounts[accountKey] = {
        device_id: ref.deviceId,
        key_id: ref.keyId ?? undefined,
        key_prefix: ref.keyPrefix ?? undefined,
      };
    }
    await credentialService.save(
      NIMBUS_DEVICE_CREDENTIAL_KEY,
      JSON.stringify({
        version: DEVICE_FILE_VERSION,
        client_id: NIMBUS_CLIENT_ID,
        device_id: identity.deviceId ?? undefined,
        public_key: identity.publicKeyPem,
        private_key: identity.privateKeyPem,
        key_id: identity.keyId ?? undefined,
        key_prefix: identity.keyPrefix ?? undefined,
        // 文件整体重写（无 spread 残留）：空 accounts 直接不落键，不存在旧值复活
        ...(Object.keys(accounts).length > 0 ? { accounts } : {}),
      }),
    );
  }

  return {
    loadOrCreate,
    save,
    createSigner: (identity) => (descriptor) =>
      signNimbusRequest(identity.privateKeyPem, identity.deviceId ?? "0", descriptor),
    publicKeyRawBase64: ed25519PublicPemToBase64Raw,
    deviceReport: () => ({
      name: hostname() || "polaris-device",
      platform: process.platform,
      appVersion: options.appVersion ?? "dev",
    }),
  };
}
