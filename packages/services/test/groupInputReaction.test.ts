import { describe, expect, it, vi } from "vitest";
import { createGroupInputReactionUpdater } from "#src/bots/providers/groupInputReaction.js";

describe("group input reactions", () => {
  it("serializes transitions and ignores late admission and duplicate completion", async () => {
    const apply = vi.fn(async (_key: string, _state: string) => {});
    const update = createGroupInputReactionUpdater(apply);
    await Promise.all([
      update("message-a", "working"),
      update("message-a", "waiting"),
      update("message-a", "done"),
      update("message-a", "working"),
      update("message-a", "done"),
    ]);
    expect(apply.mock.calls).toEqual([
      ["message-a", "working"],
      ["message-a", "done"],
    ]);
  });

  it("keeps messages independent and removes cancelled status", async () => {
    const apply = vi.fn(async (_key: string, _state: string) => {});
    const update = createGroupInputReactionUpdater(apply);
    await update("a", "waiting");
    await update("b", "working");
    await update("a", "cancelled");
    await update("a", "working");
    await update("b", "failed");
    expect(apply.mock.calls).toEqual([
      ["a", "waiting"],
      ["b", "working"],
      ["a", "cancelled"],
      ["b", "failed"],
    ]);
  });

  it("retries failed presentation without accepting older lifecycle state", async () => {
    const apply = vi
      .fn(async (_key: string, _state: string) => {})
      .mockRejectedValueOnce(new Error("network"));
    const update = createGroupInputReactionUpdater(apply);
    await expect(update("a", "done")).rejects.toThrow("network");
    await update("a", "waiting");
    await update("a", "done");
    expect(apply.mock.calls).toEqual([
      ["a", "done"],
      ["a", "done"],
    ]);
  });

  it("bounds per-message memory with FIFO eviction", async () => {
    const CAP = 2000;
    const apply = vi.fn(async (_key: string, _state: string) => {});
    const update = createGroupInputReactionUpdater(apply);
    for (let i = 0; i <= CAP; i++) {
      await update(`m-${i}`, "done");
    }
    expect(apply).toHaveBeenCalledTimes(CAP + 1);
    apply.mockClear();
    // 未淘汰的近期消息仍拒绝重复终态。
    await update(`m-${CAP}`, "done");
    await update("m-1", "done");
    expect(apply).not.toHaveBeenCalled();
    // 最老的一条（m-0）已被淘汰，记忆按 FIFO 遗忘。
    await update("m-0", "done");
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
