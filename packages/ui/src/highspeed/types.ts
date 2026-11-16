/** Polaris：Highspeed 卡业务已移除；以下类型仅保留上游签名形状，供未随砍的调用面编译通过。 */
export interface HighspeedCardSnapshot {
  cardId: string;
  expiresAt: number;
  [key: string]: unknown;
}

export interface HighspeedMessageMeta {
  cardId: string;
  outputTokens?: number;
  highspeedTps?: number;
  regularTps?: number;
  durationMs?: number;
  savedDurationMs?: number;
  [key: string]: unknown;
}

export interface HighspeedShareMetrics {
  outputTokens: number;
  durationMs?: number;
  regularTps: number;
  highspeedTps: number;
  savedDurationMs?: number;
}

export interface HighspeedSendContext {
  [key: string]: unknown;
}

export type HighspeedTurnPreparer = (input: {
  content: string;
  [key: string]: unknown;
}) => Promise<{ selection?: unknown; waitBudgetMs?: number } | null>;

export interface HighspeedTurnRecord {
  card: { cardId: string; expiresAt: number; [key: string]: unknown };
  metrics?: HighspeedShareMetrics & { metricsPersistedAt?: number };
  state: string;
  [key: string]: unknown;
}
