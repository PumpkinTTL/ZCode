import { describe, expect, it } from "vitest";
import { createAccountRequestAuthService } from "../src/index.js";
import { AccountRequestCredentialUnavailableError } from "../src/model-provider/accountRequestAuthService.js";

describe("AccountRequestAuthService", () => {
  // Polaris fork：官方账号体系（Z.ai / BigModel Coding Plan）移除后，没有 zhipu-account
  // provider 可用，服务恒定表达「无可用账号请求材料」。原有「把请求委托给注入 Resolver」
  // 的用例针对已删除的 Resolver 注入路径，按空壳契约改为验证 fail-closed 语义。
  it("没有可用账号连接时 resolveCurrent fail-closed 并带 providerId", async () => {
    const service = createAccountRequestAuthService();

    await expect(
      service.resolveCurrent({
        providerId: "account:zai-individual-coding-plan",
        modelId: "glm-5",
        accountAccess: {
          type: "zhipu-account",
          family: "zai",
          planKind: "individual-coding-plan",
        },
        reason: "model-request",
      }),
    ).rejects.toBeInstanceOf(AccountRequestCredentialUnavailableError);
  });

  it("assertCurrent 同样 fail-closed，不在服务层回退或伪造凭据", async () => {
    const service = createAccountRequestAuthService();

    await expect(
      service.assertCurrent({
        providerId: "account:zai-start-plan",
        accountAccess: {
          type: "zhipu-account",
          family: "zai",
          planKind: "start-plan",
        },
      }),
    ).rejects.toBeInstanceOf(AccountRequestCredentialUnavailableError);
  });

  it("resolveAccessCurrent 返回 null 表示无账号作用域可解析", async () => {
    const service = createAccountRequestAuthService();

    await expect(
      service.resolveAccessCurrent({
        type: "zhipu-account",
        family: "zai",
        planKind: "individual-coding-plan",
      }),
    ).resolves.toBeNull();
  });
});
