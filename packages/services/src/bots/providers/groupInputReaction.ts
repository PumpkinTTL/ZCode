export type GroupInputReaction = "waiting" | "working" | "done" | "failed" | "cancelled";

const rank: Record<GroupInputReaction, number> = {
  waiting: 0,
  working: 1,
  done: 2,
  failed: 2,
  cancelled: 2,
};

/**
 * 每条消息一份状态记忆，用来拒绝迟到事件与重复终态，单消息内串行应用。
 * FIFO 上限：极老消息的记忆会被遗忘，其迟到事件按新消息处理；实际影响需要
 * 「该消息之后又来了上千条消息、且此时才补发这条的旧事件」才会出现，可忽略，
 * 但不设上限时长跑 host 会按消息数无界累积。
 */
const GROUP_INPUT_REACTION_ENTRIES_CAP = 2000;

export function createGroupInputReactionUpdater(
  apply: (key: string, state: GroupInputReaction) => Promise<void>,
) {
  const entries = new Map<
    string,
    {
      desired: GroupInputReaction;
      applied?: GroupInputReaction;
      pending: Promise<void>;
    }
  >();
  return (key: string, state: GroupInputReaction): Promise<void> => {
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= GROUP_INPUT_REACTION_ENTRIES_CAP) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entry = { desired: state, pending: Promise.resolve() };
      entries.set(key, entry);
    } else if (
      rank[state] < rank[entry.desired] ||
      (rank[entry.desired] === 2 && state !== entry.desired)
    ) {
      return Promise.resolve();
    }
    entry.desired = state;
    const current = entry;
    // 接收确认可能晚于开始/结束事件；单消息串行并禁止状态回退，避免覆盖终态。
    current.pending = current.pending
      .catch(() => {})
      .then(async () => {
        if (current.applied === state) return;
        await apply(key, state);
        current.applied = state;
      });
    return current.pending;
  };
}
