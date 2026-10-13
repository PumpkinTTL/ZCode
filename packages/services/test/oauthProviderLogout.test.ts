import { describe, expect, it, vi } from "vitest";
import { ZAI_PROVIDER_ID } from "@zcode/shared";
import { createOAuthProviderLogoutHandler } from "../src/oauth/oauthProviderLogout.js";

describe("oauthProviderLogout", () => {
  // Polaris fork：官方账号体系移除后，派生 Coding Plan / Start Plan provider key 的清理
  // 已无对象（accountProviderCredentialStore 依赖一并删除）；保留的契约只剩
  // 「通知 Account Source 刷新」这一个扩展点。
  it("新 Provider Runtime 登出后只刷新 Account Source", async () => {
    const refreshAccountProviders = vi.fn(async () => {});
    const handleLogout = createOAuthProviderLogoutHandler({
      refreshAccountProviders,
    });

    await handleLogout(ZAI_PROVIDER_ID, "account-a");

    expect(refreshAccountProviders).toHaveBeenCalledOnce();
    expect(refreshAccountProviders).toHaveBeenCalledWith("oauth-logout:zai");
  });

  it("未注入刷新回调时登出是安全空操作", async () => {
    const handleLogout = createOAuthProviderLogoutHandler();

    await expect(handleLogout(ZAI_PROVIDER_ID, "account-a")).resolves.toBeUndefined();
  });
});
