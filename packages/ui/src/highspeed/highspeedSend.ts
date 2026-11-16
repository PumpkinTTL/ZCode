/** Polaris：Highspeed 发送管线移除后的 inert 桩——无卡，预算为 0，不准备任何加速上下文。 */
export const HIGHSPEED_SEND_WAIT_BUDGET_MS = 0;

export interface HighspeedSendContext {
  [key: string]: unknown;
}

export type HighspeedTurnPreparer = (input: {
  content: string;
  [key: string]: unknown;
}) => Promise<{ selection?: unknown; waitBudgetMs?: number } | null>;

export function prepareHighspeedSendContext(): Promise<null> {
  return Promise.resolve(null);
}

export function readRegularTpsWithinSendBudget(): number | undefined {
  return undefined;
}

export function resolveHighspeedPrepareSelection(): null {
  return null;
}
