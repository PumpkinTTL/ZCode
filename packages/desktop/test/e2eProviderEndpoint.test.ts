import { describe, expect, it } from "vitest";
import { resolveBigModelApiOrigin, resolveRuntimeZCodeEndpointOrigin } from "@zcode/shared";
import {
  getE2EProviderEndpointEnv,
  shouldUseProductionE2EProviderEndpoint,
} from "#e2e/helpers/e2e-provider-endpoint";

// Polaris：官方「请求安全校验」edition 已剪除；普通用例恒不获得控制面覆盖，
// 只有生产账号 live 用例保留生产控制面例外。

const liveTeam = "conversation-session-r3-live-bigmodel-team.test.ts";
const ordinary = "conversation-session-v4-sendnow.test.ts";
const liveShare = "conversation-session-share-ssh-artifact.test.ts";

describe("E2E provider endpoint ownership", () => {
  it.each([liveTeam, liveShare])("生产账号统一使用可沿 SSH 传递的生产环境：%s", (spec) => {
    const env = {
      ZCODE_ENV: "test",
      ...getE2EProviderEndpointEnv([spec], "deepseek", "replay"),
    };
    expect(resolveRuntimeZCodeEndpointOrigin(env)).toBe("https://zcode.z.ai");
    // Polaris：官方 BigModel 端点改指自有网关（resolveBigModelApiOrigin → nimbus）。
    expect(resolveBigModelApiOrigin(env)).toBe("https://nimbus.bitlesu.com");
    // SSH 只透传环境档位，不透传 BIGMODEL_API_BASE_URL；远端仍必须解析到自有域。
    expect(env.ZCODE_ENV).toBe("production");
    expect(resolveBigModelApiOrigin({ ZCODE_ENV: env.ZCODE_ENV })).toBe("https://nimbus.bitlesu.com");
  });

  it("普通用例不获得任何控制面覆盖", () => {
    expect(getE2EProviderEndpointEnv([ordinary], "deepseek", "replay")).toEqual({});
    expect(shouldUseProductionE2EProviderEndpoint([ordinary], "deepseek", "replay")).toBe(false);
    expect(getE2EProviderEndpointEnv([ordinary], "example-preset", "capture")).toEqual({});
    expect(shouldUseProductionE2EProviderEndpoint([ordinary], "example-preset", "capture")).toBe(
      false,
    );
  });
  it("SSH share 的真实账号与分享 API 使用同一生产环境", () => {
    expect(shouldUseProductionE2EProviderEndpoint([liveShare], "deepseek", "replay")).toBe(true);
  });

  it.each([
    [liveShare, ordinary],
    [liveShare, liveTeam],
  ])("真实 share 必须独立运行：%j", (...specs) => {
    expect(() => shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toThrow(
      "独立运行",
    );
  });
  it.each([
    liveTeam,
    `/repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${liveTeam}`,
    `file:///repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${liveTeam}`,
    `C:\\repo\\packages\\desktop\\test\\e2e\\${liveTeam}`,
  ])("生产账号材料的独立 live-team 使用生产控制面：%s", (spec) => {
    expect(shouldUseProductionE2EProviderEndpoint([spec], "deepseek", "replay")).toBe(true);
  });

  it.each([{ specs: [] }, { specs: ["conversation-session-r3-live-zapi.test.ts"] }])(
    "普通或 ZAPI 用例不获得生产账号控制面例外：$specs",
    ({ specs }) => {
      expect(shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toBe(false);
    },
  );

  it.each([
    [liveTeam, ordinary],
    [ordinary, liveTeam],
  ])("拒绝 live-team 与其他 spec 混跑：%j", (...specs) => {
    expect(() => shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toThrow(
      "live-team 必须独立运行",
    );
  });
});
