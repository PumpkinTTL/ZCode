import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- 构建脚本是 .mjs，无类型声明
import { rejectUpstreamEndpoints } from "../scripts/polaris-endpoint-guard.mjs";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("polaris-endpoint-guard", () => {
  it("摘除上游域名，保留自有域名", () => {
    expect(
      rejectUpstreamEndpoints({
        ZCODE_BASE_URL: "https://zcode.z.ai",
        ZAI_OAUTH_ORIGIN: "https://chat.z.ai",
        ZAI_BUSINESS_BASE_URL: "https://api.z.ai",
        BIGMODEL_API_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ZCODE_PRODUCTION_BASE_URL: "https://nimbus.bitlesu.com",
      }),
    ).toEqual({ ZCODE_PRODUCTION_BASE_URL: "https://nimbus.bitlesu.com" });
  });

  it("显式放行时不过滤（迁移验证用）", () => {
    expect(
      rejectUpstreamEndpoints(
        { ZCODE_BASE_URL: "https://zcode.z.ai" },
        { allowUpstream: true },
      ),
    ).toEqual({ ZCODE_BASE_URL: "https://zcode.z.ai" });
  });

  it("非 URL 值不受影响（client_id 等非端点键混入时不误删）", () => {
    expect(
      rejectUpstreamEndpoints({ ZAI_OAUTH_CLIENT_ID: "client_P8X5CMWmlaRO9gyO-KSqtg" }),
    ).toEqual({ ZAI_OAUTH_CLIENT_ID: "client_P8X5CMWmlaRO9gyO-KSqtg" });
  });
});

describe("仓库 .env 端点契约", () => {
  // 上游 v3.15.1 的 .env.production/.env.development 带 z.ai 端点；合并时曾把它们
  // 覆盖回仓库，导致 renderer 产物烤进 VITE_ZCODE_BASE_URL=https://zcode.z.ai。
  // 这里锁定「提交进仓库的 .env* 不得声明上游端点」。
  for (const fileName of [".env.production", ".env.development"]) {
    it(`${fileName} 不含上游端点`, () => {
      const content = readFileSync(resolve(repoRoot, fileName), "utf-8");
      expect(content).not.toMatch(/z\.ai|bigmodel\.cn|zhipuai\.cn/iu);
    });
  }
});
