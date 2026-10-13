// 会话常驻 Selection 的恢复回归。
import { describe, expect, it } from "vitest";
import {
  SESSION_ENTRY_MODEL_SELECTION,
  type SessionEntryInfo,
  type SessionId,
  type SessionStorePort,
} from "@zcode/contracts";
import { readSessionModelSelection } from "../src/app/session-store.js";

const SESSION_ID = "sess_restore" as SessionId;

function storeWithEntryData(data: unknown): Pick<SessionStorePort, "sessionEntries"> {
  const entry = {
    id: `${SESSION_ID}:runtime-model-selection`,
    sessionID: SESSION_ID,
    type: SESSION_ENTRY_MODEL_SELECTION,
    time: { created: 1, updated: 1 },
    data,
  } as SessionEntryInfo;
  return { sessionEntries: async () => [entry] } as Pick<SessionStorePort, "sessionEntries">;
}

describe("恢复会话常驻 Selection", () => {
  it("普通选型原样恢复", async () => {
    await expect(
      readSessionModelSelection(
        storeWithEntryData({
          providerId: "account:bigmodel-team-coding-plan",
          modelId: "GLM-5.3",
          options: { reasoningLevel: "max" },
        }),
        SESSION_ID,
      ),
    ).resolves.toEqual({
      providerId: "account:bigmodel-team-coding-plan",
      modelId: "GLM-5.3",
      options: { reasoningLevel: "max" },
    });
  });

  it("档位非法走模型身份兜底", async () => {
    await expect(
      readSessionModelSelection(
        storeWithEntryData({
          providerId: "account:bigmodel-team-coding-plan",
          modelId: "GLM-5.3",
          options: { reasoningLevel: 3 },
        }),
        SESSION_ID,
      ),
    ).resolves.toEqual({ providerId: "account:bigmodel-team-coding-plan", modelId: "GLM-5.3" });
  });

  it("没有 entry 时返回空", async () => {
    await expect(
      readSessionModelSelection({ sessionEntries: async () => [] }, SESSION_ID),
    ).resolves.toBeUndefined();
    await expect(readSessionModelSelection({}, SESSION_ID)).resolves.toBeUndefined();
  });
});
