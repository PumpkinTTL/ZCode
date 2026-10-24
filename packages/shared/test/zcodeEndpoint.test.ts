import { describe, expect, it } from "vitest";
import {
  DEFAULT_BIGMODEL_API_ORIGIN,
  DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL,
  DEFAULT_ZAI_BUSINESS_BASE_URL,
  DEFAULT_ZAI_OAUTH_CLIENT_ID,
  DEFAULT_ZAI_OAUTH_ORIGIN,
  DEFAULT_ZCODE_ENDPOINT_ORIGIN,
  TEST_BIGMODEL_API_ORIGIN,
  TEST_ZAI_BUSINESS_BASE_URL,
  TEST_ZAI_OAUTH_CLIENT_ID,
  TEST_ZAI_OAUTH_ORIGIN,
  TEST_ZCODE_ENDPOINT_ORIGIN,
  buildBigModelApiUrl,
  buildBigModelCodingPlanTeamManageUrl,
  buildRuntimeZCodeApiUrl,
  buildRuntimeZCodeEndpointUrls,
  buildRuntimeZaiBusinessUrl,
  buildRuntimeZaiOAuthUrl,
  buildZCodeEndpointUrls,
  normalizeZCodeEndpointOrigin,
  resolveBigModelApiOrigin,
  resolveRuntimeProductEndpointConfig,
  resolveWebRemoteControlRelayWsUrl,
  resolveZaiBusinessBaseUrl,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
  resolveZCodeEndpointOrigin,
} from "../src/zcodeEndpoint.js";
import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";

// Polaris：端点默认值已指向自有域名（nimbus），期望值一律从模块导出的 DEFAULT_*/TEST_* 常量推导，
// 保证测试与品牌无关；覆盖优先级、版本分界、URL 拼接等结构行为与上游保持一致。

describe("zcodeEndpoint", () => {
  it("defaults to the scoped origin in every env without env base url", () => {
    expect(resolveZCodeEndpointOrigin({ env: "test" })).toBe(TEST_ZCODE_ENDPOINT_ORIGIN);
    expect(resolveZCodeEndpointOrigin({ env: "production" })).toBe(DEFAULT_ZCODE_ENDPOINT_ORIGIN);
  });

  it("keeps the non-production settings override above env base url", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "test",
        envBaseOrigin: "https://endpoint.example.com",
        overrideOrigin: "http://localhost:3030/api/v1",
      }),
    ).toBe("http://localhost:3030");
  });

  it("uses a non-production override after normalizing to origin", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "test",
        overrideOrigin: "https://endpoint.example.com/api/v1/ignored?x=1",
      }),
    ).toBe("https://endpoint.example.com");
  });

  it("ignores overrides in production", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "production",
        envBaseOrigin: "https://endpoint.example.com",
        overrideOrigin: "http://localhost:3030",
      }),
    ).toBe("https://endpoint.example.com");
  });

  it("derives http and websocket urls from the same origin", () => {
    expect(buildZCodeEndpointUrls("http://localhost:3030")).toEqual({
      origin: "http://localhost:3030",
      apiBaseUrl: "http://localhost:3030/api/v1",
      remoteUrl: "http://localhost:3030/remote/v3",
      webRemoteCallbackUrl: "http://localhost:3030/remote/v4",
      webShareCallbackUrl: "http://localhost:3030/cn/share/callback",
      // V2 relay 协议契约钉死 ws 路径（web-remote-relay/contract.ts），origin 跟随端点。
      relayWsUrl: "ws://localhost:3030/api/v1/remote/ws2",
    });
  });

  it("uses remote v3 for app versions below 3.4.0", () => {
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.3.9" }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
  });

  it("uses remote v4 for app versions at or above 3.4.0", () => {
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.4.0" }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v4");
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.4.1" }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v4");
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.5.0-beta.1" })
        .remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v4");
  });

  it("keeps prerelease and invalid app versions on remote v3", () => {
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.4.0-beta.1" })
        .remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "dev" }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "03.4.0" }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.4.1-alpha..1" })
        .remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
    expect(
      buildZCodeEndpointUrls("https://endpoint.example.com", { appVersion: "3.4.1-01" }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
  });

  it("derives runtime endpoint urls from ZCODE_ENV and ZCODE_BASE_URL overrides", () => {
    expect(buildRuntimeZCodeEndpointUrls({ ZCODE_ENV: "test" }).origin).toBe(
      TEST_ZCODE_ENDPOINT_ORIGIN,
    );
    expect(buildRuntimeZCodeEndpointUrls({ ZCODE_ENV: "production" }).origin).toBe(
      DEFAULT_ZCODE_ENDPOINT_ORIGIN,
    );
    expect(buildRuntimeZCodeEndpointUrls({}).origin).toBe(DEFAULT_ZCODE_ENDPOINT_ORIGIN);
    expect(
      buildRuntimeZCodeEndpointUrls({
        ZCODE_ENV: "test",
        ZCODE_BASE_URL: "https://endpoint.example.com/ignored/path",
      }).remoteUrl,
    ).toBe("https://endpoint.example.com/remote/v3");
  });

  it("derives V2 relay from each endpoint origin", () => {
    // Polaris：默认端点为自有 nimbus，ws 路径保持 V2 relay 协议契约（/api/v1/remote/ws2）。
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
      }),
    ).toBe(DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL);
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
      }),
    ).toBe(DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL);
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: "http://localhost:3030",
      }),
    ).toBe("ws://localhost:3030/api/v1/remote/ws2");
  });

  it("allows an explicit web remote control relay url override", () => {
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
        overrideUrl: " ws://localhost:8787/api/v1/remote/ws2 ",
      }),
    ).toBe("ws://localhost:8787/api/v1/remote/ws2");
  });

  it("derives BigModel API origin from ZCODE_ENV", () => {
    expect(resolveBigModelApiOrigin({ ZCODE_ENV: "production" })).toBe(
      DEFAULT_BIGMODEL_API_ORIGIN,
    );
    expect(resolveBigModelApiOrigin({ ZCODE_ENV: "test" })).toBe(TEST_BIGMODEL_API_ORIGIN);
    expect(buildBigModelApiUrl({ ZCODE_ENV: "test" }, "/api/biz/subscription/list")).toBe(
      `${TEST_BIGMODEL_API_ORIGIN}/api/biz/subscription/list`,
    );
  });

  it("derives BigModel Coding Plan team manage url from ZCODE_ENV", () => {
    expect(buildBigModelCodingPlanTeamManageUrl({ ZCODE_ENV: "test" })).toBe(
      `${TEST_BIGMODEL_API_ORIGIN}/coding-plan/team/plans`,
    );
    expect(buildBigModelCodingPlanTeamManageUrl({ ZCODE_ENV: "production" })).toBe(
      `${DEFAULT_BIGMODEL_API_ORIGIN}/coding-plan/team/plans`,
    );
  });

  it("resolves all product endpoints for the test product environment", () => {
    expect(resolveRuntimeProductEndpointConfig({ ZCODE_ENV: "test" })).toMatchObject({
      zcodeEnv: "test",
      zcodeEndpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: TEST_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: TEST_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: TEST_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: TEST_BIGMODEL_API_ORIGIN,
    });
  });

  it("resolves all product endpoints for the production product environment", () => {
    expect(resolveRuntimeProductEndpointConfig({ ZCODE_ENV: "production" })).toMatchObject({
      zcodeEnv: "production",
      zcodeEndpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: DEFAULT_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: DEFAULT_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: DEFAULT_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: DEFAULT_BIGMODEL_API_ORIGIN,
    });
  });

  it("builds product endpoint URLs from the selected environment", () => {
    expect(buildRuntimeZCodeApiUrl({ ZCODE_ENV: "test" }, "/api/v1/oauth/token")).toBe(
      `${TEST_ZCODE_ENDPOINT_ORIGIN}/api/v1/oauth/token`,
    );
    expect(buildRuntimeZaiOAuthUrl({ ZCODE_ENV: "test" }, "/api/oauth/authorize")).toBe(
      `${TEST_ZAI_OAUTH_ORIGIN}/api/oauth/authorize`,
    );
    expect(buildRuntimeZaiBusinessUrl({ ZCODE_ENV: "test" }, "/api/auth/z/login")).toBe(
      `${TEST_ZAI_BUSINESS_BASE_URL}/api/auth/z/login`,
    );
    expect(buildBigModelApiUrl({ ZCODE_ENV: "test" }, "/login")).toBe(
      `${TEST_BIGMODEL_API_ORIGIN}/login`,
    );
  });

  it("keeps environment-scoped endpoint overrides centralized", () => {
    const env = {
      ZCODE_ENV: "test",
      ZCODE_TEST_BASE_URL: "https://test-zcode.example.com/path",
      ZAI_TEST_OAUTH_ORIGIN: "https://test-oauth.example.com/oauth",
      ZAI_TEST_BUSINESS_BASE_URL: "https://test-business.example.com/api",
      ZAI_TEST_OAUTH_CLIENT_ID: "client_test_override",
      BIGMODEL_TEST_API_BASE_URL: "https://test-bigmodel.example.com/base",
    };

    expect(resolveRuntimeProductEndpointConfig(env)).toMatchObject({
      zcodeEndpointOrigin: "https://test-zcode.example.com",
      zaiOAuthOrigin: "https://test-oauth.example.com",
      zaiBusinessBaseUrl: "https://test-business.example.com",
      zaiOAuthClientId: "client_test_override",
      bigModelApiOrigin: "https://test-bigmodel.example.com",
    });
  });

  it("keeps unscoped endpoint overrides above scoped endpoint overrides", () => {
    const env = {
      ZCODE_ENV: "test",
      ZAI_OAUTH_ORIGIN: "https://oauth-global.example.com",
      ZAI_TEST_OAUTH_ORIGIN: "https://oauth-test.example.com",
      ZAI_BUSINESS_BASE_URL: "https://business-global.example.com",
      ZAI_TEST_BUSINESS_BASE_URL: "https://business-test.example.com",
      ZAI_OAUTH_CLIENT_ID: "client_global",
      ZAI_TEST_OAUTH_CLIENT_ID: "client_test",
      BIGMODEL_API_BASE_URL: "https://bigmodel-global.example.com",
      BIGMODEL_TEST_API_BASE_URL: "https://bigmodel-test.example.com",
    };

    expect(resolveZaiOAuthOrigin(env)).toBe("https://oauth-global.example.com");
    expect(resolveZaiBusinessBaseUrl(env)).toBe("https://business-global.example.com");
    expect(resolveZaiOAuthClientId(env)).toBe("client_global");
    expect(resolveBigModelApiOrigin(env)).toBe("https://bigmodel-global.example.com");
  });

  it("ignores blank runtime endpoint overrides", () => {
    const env = {
      ZCODE_ENV: "test",
      ZCODE_BASE_URL: " ",
      ZCODE_TEST_BASE_URL: "\t",
      ZAI_OAUTH_ORIGIN: "",
      ZAI_TEST_OAUTH_ORIGIN: " ",
      ZAI_BUSINESS_BASE_URL: " ",
      ZAI_TEST_BUSINESS_BASE_URL: "",
      ZAI_OAUTH_CLIENT_ID: "",
      ZAI_TEST_OAUTH_CLIENT_ID: " ",
      BIGMODEL_API_BASE_URL: " ",
      BIGMODEL_TEST_API_BASE_URL: "",
    };

    expect(resolveRuntimeProductEndpointConfig(env)).toMatchObject({
      zcodeEndpointOrigin: TEST_ZCODE_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: TEST_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: TEST_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: TEST_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: TEST_BIGMODEL_API_ORIGIN,
    });
  });

  it("rejects non-http endpoint origins", () => {
    expect(() => normalizeZCodeEndpointOrigin("file:///tmp/zcode")).toThrow(/http or https/);
  });

  it("persists optional endpoint override in app settings", () => {
    expect(
      appSettingsSchema.parse({ zcodeEndpointOrigin: "https://endpoint.example.com/path" })
        .zcodeEndpointOrigin,
    ).toBe("https://endpoint.example.com");
    expect(
      appSettingsPatchSchema.parse({ zcodeEndpointOrigin: "http://localhost:3030/foo" })
        .zcodeEndpointOrigin,
    ).toBe("http://localhost:3030");
  });
});
