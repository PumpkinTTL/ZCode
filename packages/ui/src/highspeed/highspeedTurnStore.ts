/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */
import type { HighspeedCardSnapshot, HighspeedMessageMeta } from "@zcode/shared";
import { planHighspeedTranscriptHydration } from "@/highspeed/highspeedTurnHydration.js";
import { calculateHighspeedSavedDurationMs } from "@/highspeed/highspeedSavedTime.js";
import { isHighspeedShareEligible } from "@/highspeed/highspeedShare.js";

export interface HighspeedTranscriptRow {
  sourceCommandId?: string;
  createdAt: number;
  highspeed?: HighspeedMessageMeta;
}

export interface HighspeedTurnMetrics {
  outputTokens: number;
  durationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  otherDurationMs?: number;
  regularTps: number;
  highspeedTps?: number;
  savedDurationMs?: number;
}

export interface HighspeedShareMetrics extends HighspeedTurnMetrics {
  highspeedTps: number;
}

export interface HighspeedTurnRecord {
  sessionId: string;
  sourceCommandId: string;
  card: HighspeedCardSnapshot;
  createdAt: number;
  completedAt?: number;
  metrics?: HighspeedTurnMetrics;
  metricsPersistedAt?: number;
  autoShareAttemptedAt?: number;
  autoSharedAt?: number;
}

export interface HighspeedCardAutoShareCandidate {
  cardId: string;
  expiresAt: number;
  metrics: HighspeedShareMetrics;
}

const MAX_RECORDS = 300;

let records: HighspeedTurnRecord[] = [];
const highspeedTpsByCardId = new Map<string, number>();
let healthyAttemptSequence = 0;
const healthyAttemptsByCardId = new Map<string, { expiry?: number; completion?: number }>();
export interface HighspeedHealthyAttempt {
  cardId: string;
  phase: "expiry" | "completion";
  id: number;
}
const listeners = new Set<() => void>();

function publishChange(): void {
  for (const listener of listeners) listener();
}

export function recordHighspeedTurn(record: HighspeedTurnRecord): void  {
  return null as unknown as never;
}

/**
 * 冷启动恢复与跨端追平：到期时 renderer 可能不在场，内存 store 没有机会登记/收口这张卡；
 * 远控 Renderer 也可能先登记运行中 row、桌面端随后才把完成态持久化进 transcript。
 * 合并口径见 planHighspeedTranscriptHydration；这里只负责按序落库并发一次通知。
 * 返回产生变化的 row 数；无变化不发通知，重复水合不会造成渲染抖动。
 */
export function hydrateHighspeedTurnsFromTranscript(
  sessionId: string,
  rows: readonly HighspeedTranscriptRow[],
): number  {
  return null as unknown as never;
}

export function discardHighspeedTurn(sourceCommandId: string): boolean  {
  return null as unknown as never;
}

export function completeHighspeedTurn(params: {
  sourceCommandId: string;
  outputTokens: number;
  durationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  otherDurationMs?: number;
  completedAt?: number;
}): HighspeedTurnRecord | null  {
  return null as unknown as never;
}

export function setHighspeedCardTps(cardId: string, highspeedTps: number): void  {
  return null as unknown as never;
}

export function getHighspeedCardTps(cardId: string): number | undefined  {
  return null as unknown as never;
}

/**
 * 卡级 healthy 查询防重必须跨 SessionPane 生命周期存在；组件 ref 会在重挂载后清空，
 * 导致同一张已过期卡持续请求并放大服务端限流。每张卡最多允许到期查询一次，
 * 若当时仍有 Turn 运行，再允许最后一轮结束后补查一次。
 */
export function claimHighspeedHealthyAttempt(
  cardId: string,
  allTurnsCompleted: boolean,
): HighspeedHealthyAttempt | null  {
  return null as unknown as never;
}

/** 跳过归属不明的请求不消费机会；旧Promise只能释放自己的占位，不广播空转重试。 */
export function releaseHighspeedHealthyAttempt(attempt: HighspeedHealthyAttempt): void  {
  return null as unknown as never;
}

/** 重登可重新核验未取得TPS的卡；已存TPS和分享结果不清理。 */
export function resetHighspeedHealthyAttempts(): void  {
  return null as unknown as never;
}

export function markHighspeedTurnMetricsPersisted(
  sourceCommandId: string,
  savedDurationMs: number,
  persistedAt = Date.now(),
): void  {
  return null as unknown as never;
}

export function markHighspeedCardAutoShared(cardId: string, autoSharedAt = Date.now()): void  {
  return null as unknown as never;
}

export function claimHighspeedCardAutoShare(
  cardId: string,
  attemptedAt = Date.now(),
): HighspeedTurnRecord[] | null  {
  return null as unknown as never;
}

export function getHighspeedTurnByCommandId(
  sourceCommandId: string | undefined,
): HighspeedTurnRecord | null  {
  return null as unknown as never;
}

export function listHighspeedTurnsByCard(cardId: string): HighspeedTurnRecord[]  {
  return null as unknown as never;
}

export function listHighspeedTurnsBySession(sessionId: string): HighspeedTurnRecord[]  {
  return null as unknown as never;
}

export function listPendingHighspeedTurns(sessionId: string): HighspeedTurnRecord[]  {
  return null as unknown as never;
}

export function listExpiredHighspeedCardsAwaitingTps(
  sessionId: string,
  now: number,
): Array<{ cardId: string; ownerKey: string; allTurnsCompleted: boolean }>  {
  return null as unknown as never;
}

export function listHighspeedTurnsAwaitingMetricsPersistence(
  sessionId: string,
): HighspeedTurnRecord[]  {
  return null as unknown as never;
}

export function listHighspeedCardAutoShareCandidates(
  sessionId: string,
): HighspeedCardAutoShareCandidate[]  {
  return null as unknown as never;
}

export function resolveNextHighspeedAutoShareAt(sessionId: string): number | null  {
  return null as unknown as never;
}

export function subscribeHighspeedTurns(listener: () => void): () => void  {
  return null as unknown as never;
}

// 记录本身是不可变快照。消费者浅比较这些依赖，不能订阅全局版本使无关会话一起更新。
// 卡级聚合跨会话，必须包含同卡全部记录与 TPS，而不能只截取当前会话的记录。
function highspeedCardDependencies(
  cardIds: ReadonlySet<string>,
): readonly (HighspeedTurnRecord | number | undefined)[] {
  return [
    ...records.filter((record) => cardIds.has(record.card.cardId)),
    ...Array.from(cardIds, getHighspeedCardTps),
  ];
}

export function getHighspeedSessionDependencies(
  sessionId: string | null,
): readonly (HighspeedTurnRecord | number | undefined)[]  {
  return null as unknown as never;
}

export function getHighspeedTurnDependencies(
  sourceCommandId: string | undefined,
): readonly (HighspeedTurnRecord | number | undefined)[]  {
  return null as unknown as never;
}

export function aggregateHighspeedCardMetrics(cardId: string): HighspeedShareMetrics  {
  return null as unknown as never;
}
