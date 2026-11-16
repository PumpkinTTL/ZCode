/** Polaris：Highspeed 卡业务移除后的 inert 店面——恒为空集，全部操作为无副作用空转。 */
import type { HighspeedTurnRecord } from "./types.js";

export function subscribeHighspeedTurns(listener: () => void): () => void {
  void listener;
  return () => {};
}

export function getHighspeedSessionDependencies(): Record<string, never> {
  return {};
}

export function getHighspeedTurnByCommandId(_commandId: string | undefined): HighspeedTurnRecord | null {
  return null;
}

export function getHighspeedTurnDependencies(_commandId: string | undefined): HighspeedTurnRecord | null {
  return null;
}

export function listPendingHighspeedTurns(): HighspeedTurnRecord[] {
  return [];
}

export function listExpiredHighspeedCardsAwaitingTps(): HighspeedTurnRecord[] {
  return [];
}

export function listHighspeedTurnsAwaitingMetricsPersistence(): HighspeedTurnRecord[] {
  return [];
}

export function listHighspeedCardAutoShareCandidates(): HighspeedTurnRecord[] {
  return [];
}

export function recordHighspeedTurn(): void {}

export function completeHighspeedTurn(): void {}

export function discardHighspeedTurn(): void {}

export function hydrateHighspeedTurnsFromTranscript(): void {}

export function claimHighspeedCardAutoShare(): boolean {
  return false;
}

export function markHighspeedCardAutoShared(): void {}

export function claimHighspeedHealthyAttempt(): boolean {
  return false;
}

export function releaseHighspeedHealthyAttempt(): void {}

export function resetHighspeedHealthyAttempts(): void {}

export function getHighspeedCardTps(): number | undefined {
  return undefined;
}

export function setHighspeedCardTps(): void {}

export function resolveNextHighspeedAutoShareAt(): number | undefined {
  return undefined;
}

export function markHighspeedTurnMetricsPersisted(): void {}
