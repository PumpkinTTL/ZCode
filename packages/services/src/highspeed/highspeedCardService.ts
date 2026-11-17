/**
 * Polaris：Highspeed 加速卡服务随红线砍除。此桩保 IServiceAccessor 服务面形状，
 * 全部方法恒空 / 恒 fallback，零出网；会话管线（SessionPane 等）对它的消费天然不激活。
 */
import type {
  HighspeedCardSnapshot,
  HighspeedCardUsage,
  HighspeedPrepareTurnResult,
} from "@zcode/shared";

export interface IHighspeedCardService {
  prepareTurn(params: {
    taskId: string;
    providerId: string;
    model: string;
    reasoningLevel?: string;
    waitBudgetMs?: number;
  }): Promise<HighspeedPrepareTurnResult>;
  getSnapshot(params?: { taskId?: string }): Promise<{
    card: HighspeedCardSnapshot | null;
    nextDrawAt: number | null;
    drawing: boolean;
  }>;
  /** 作废指定卡；返回是否确有卡片被作废。 */
  invalidateCard(cardId: string): Promise<boolean>;
  /** 当前鉴权会话的持卡归属键；无卡返回 null。 */
  getCurrentOwnerKey(): Promise<string | null>;
  healthy(cardId: string, ownerKey?: string): Promise<HighspeedCardUsage>;
}

/** 恒不激活的惰性实现：永不抽卡、永不报加速态。 */
export const highspeedCardServiceStub: IHighspeedCardService = {
  prepareTurn: async () => ({ kind: "fallback", reason: "unavailable", nextDrawAt: null }),
  getSnapshot: async () => ({ card: null, nextDrawAt: null, drawing: false }),
  invalidateCard: async () => false,
  getCurrentOwnerKey: async () => null,
  healthy: async () => {
    throw new Error("highspeed.unavailable");
  },
};
