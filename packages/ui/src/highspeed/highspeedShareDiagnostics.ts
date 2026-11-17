/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */
import {
  aggregateHighspeedCardMetrics,
  listHighspeedTurnsByCard,
  listHighspeedTurnsBySession,
} from "@/highspeed/highspeedTurnStore.js";
import { isHighspeedShareEligible } from "@/highspeed/highspeedShare.js";

/**
 * 诊断：这张卡为什么还不是自动分享候选，空数组表示已就绪。
 * 门禁条件与 turnStore.listHighspeedCardAutoShareCandidates 保持一致，
 * 由单测交叉断言两者结论不漂移；本模块只服务 debug 日志，不参与业务决策。
 */
export function collectHighspeedCardShareBlockers(cardId: string): string[]  {
  return null as unknown as never;
}

/**
 * 诊断：会话内已到期、但还没有尝试过自动分享的卡。
 * 用于 debug 日志回答“左下角分享卡为什么没更新”；不改变分享行为。
 */
export function listHighspeedCardsAwaitingAutoShare(sessionId: string, now: number): string[]  {
  return null as unknown as never;
}
