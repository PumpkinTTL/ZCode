import { useSyncExternalStore } from "react";

/**
 * 截图 objectURL 缓存（§31f 最小版）。
 *
 * 背景：长会话水合后，工具行里的截图以 base64 data URL 直接塞进 <img>——
 * 每张 0.5-3MB 的字符串常驻渲染堆，上百张截图就是几十 MB 的纯字符串开销。
 *
 * 本模块把 base64 在**渲染时**解码成 Blob objectURL 交给 <img>：
 * - LRU 上限 8 条 / 32MB；超限先到先逐（延迟 60s revoke，给在渲染的引用留窗口，
 *   驱逐会触发订阅通知，消费方重渲染时自动重新解码——自愈）；
 * - 解码失败（atob 异常/超大单张）回退原 data URL，展示永不破碎；
 * - 持有层瘦身（行数据里不再存 base64）涉及协议改动，另行拍板；本模块只解决
 *   DOM/img 侧的字符串放大。
 *
 * 消费方式：组件挂 `useScreenshotObjectUrlVersion()` 订阅版本号，
 * 渲染期调 `resolveScreenshotObjectUrl(…)` 取 src（命中返回 objectURL，
 * 未命中返回 data URL 并后台解码，完成后通知重渲染替换）。
 */

type ScreenshotObjectUrlEntry = {
  url: string;
  bytes: number;
  lastUse: number;
};

const MAX_ENTRIES = 8;
const MAX_BYTES = 32 * 1024 * 1024;
const EVICT_REVOKE_DELAY_MS = 60_000;
/** 单张超过 24MB(base64 字符长) 不解码——直接用 data URL，避免解码峰值。 */
const MAX_DECODE_BASE64_LENGTH = 24 * 1024 * 1024;

const cache = new Map<string, ScreenshotObjectUrlEntry>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  // 快照遍历：通知过程中订阅方增删不影响本轮集合。
  for (const listener of [...listeners]) listener();
}

function evictIfNeeded(): void {
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  if (cache.size <= MAX_ENTRIES && total <= MAX_BYTES) return;
  const lru = [...cache.entries()].sort((a, b) => a[1].lastUse - b[1].lastUse);
  for (const [key, entry] of lru) {
    if (!entry) continue;
    if (cache.size <= MAX_ENTRIES && total <= MAX_BYTES) break;
    cache.delete(key);
    total -= entry.bytes;
    // 延迟 revoke：给可能仍挂着旧 URL 的 <img> 一段窗口；窗口后由消费方
    // 重渲染时的重新解码自愈。
    window.setTimeout(() => {
      URL.revokeObjectURL(entry.url);
    }, EVICT_REVOKE_DELAY_MS);
  }
}

function decodeInBackground(fingerprint: string, mimeType: string, base64: string): void {
  if (pending.has(fingerprint)) return;
  pending.add(fingerprint);
  queueMicrotask(async () => {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      cache.set(fingerprint, { url, bytes: blob.size, lastUse: Date.now() });
      evictIfNeeded();
      version += 1;
      notify();
    } catch {
      // 解码失败：消费方继续用 data URL，静默即可。
    } finally {
      pending.delete(fingerprint);
    }
  });
}

/** 核心解析：命中返回 objectURL；未命中同步返回 data URL 并后台解码。 */
export function resolveScreenshotObjectUrl(
  fingerprint: string,
  mimeType: string,
  base64: string,
): string {
  const hit = cache.get(fingerprint);
  if (hit) {
    hit.lastUse = Date.now();
    return hit.url;
  }
  if (base64.length > MAX_DECODE_BASE64_LENGTH) {
    return `data:${mimeType};base64,${base64}`;
  }
  decodeInBackground(fingerprint, mimeType, base64);
  return `data:${mimeType};base64,${base64}`;
}

/** 便利封装：直接吃 data URL（CUA 截图链路的形态）。 */
export function resolveScreenshotObjectUrlFromDataUrl(dataUrl: string): string {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/iu.exec(dataUrl);
  const mimeType = match?.[1];
  const base64 = match?.[2];
  if (!mimeType || !base64) return dataUrl;
  const fingerprint = `${mimeType}:${dataUrl.length}:${dataUrl.slice(-48)}`;
  return resolveScreenshotObjectUrl(fingerprint, mimeType, base64);
}

export function subscribeScreenshotObjectUrls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getScreenshotObjectUrlVersion(): number {
  return version;
}

/** React 订阅钩子：解码完成/驱逐后触发重渲染，渲染期取最新 src。 */
export function useScreenshotObjectUrlVersion(): number {
  return useSyncExternalStore(subscribeScreenshotObjectUrls, getScreenshotObjectUrlVersion);
}
