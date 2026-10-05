// 帧契约实现。image_ref 文本块是所有坐标动作的栅格凭证（one-use）：
// 形状 {"image_ref":{"frame_id","authority","width","height"}}，与 image 块紧邻；
// authority 为一次性凭证，由 helper 的帧注册表在坐标派发时校验并消费。
// 消费者：core/tool/executor（保护/清零）、core/mcp/image-normalization（preserve gate）、
// node-repl-host（result.ts 取最新帧对）。
export const OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY = "zcode.cua/official-frame-integrity-v1";

export const OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION = "official_cua_frame_v1";

export const OFFICIAL_CUA_IMAGE_INLINE_BASE64_BYTES = 200 * 1024;

function parseImageRefPayload(text) {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || !Object.hasOwn(parsed, "image_ref")) return undefined;
  const imageRef = parsed.image_ref;
  if (!imageRef || typeof imageRef !== "object" || Array.isArray(imageRef)) return undefined;
  return imageRef;
}

export function isOfficialCuaImageRefText(text) {
  return parseImageRefPayload(text) !== undefined;
}

export function containsOfficialCuaImageRefCredentialText(text) {
  const imageRef = parseImageRefPayload(text);
  return Boolean(imageRef && typeof imageRef.authority === "string" && imageRef.authority !== "");
}

export function containsImageRefAuthority(text) {
  return containsOfficialCuaImageRefCredentialText(text);
}

export function parseOfficialCuaImageRef(text) {
  const imageRef = parseImageRefPayload(text);
  return imageRef && typeof imageRef.authority === "string" && imageRef.authority !== ""
    ? { authority: imageRef.authority }
    : undefined;
}

export function readRasterEnvelopeIdentity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const algorithm = input.algorithm ?? input.integrity?.algorithm;
  return typeof algorithm === "string" && algorithm !== "" ? { algorithm } : undefined;
}

/**
 * 帧原样保留：不压缩、不重排、不丢 image/image_ref 邻接 ——
 * 坐标就是"该栅格像素"，重采样会破坏契约。
 */
export async function preserveOfficialCuaFrameResult(result) {
  return result;
}

export function attestOfficialCuaFrameContent(content, expectedKind) {
  const pair = findOfficialCuaFrameContentPair(content);
  if (!pair) return undefined;
  const kind = OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION;
  if (expectedKind !== undefined && expectedKind !== kind) return undefined;
  return { kind };
}

export function findOfficialCuaFrameContentPair(content) {
  if (!Array.isArray(content)) return undefined;
  for (let index = 0; index < content.length - 1; index += 1) {
    const image = content[index];
    const imageRef = content[index + 1];
    if (
      image?.type === "image" &&
      imageRef?.type === "text" &&
      isOfficialCuaImageRefText(imageRef.text)
    ) {
      return { image, imageRef, imageIndex: index, imageRefIndex: index + 1 };
    }
  }
  return undefined;
}
