import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  buildBigModelApiUrl,
  buildRuntimeZaiBusinessUrl,
  buildRuntimeZaiOAuthUrl,
} from "@zcode/shared";
import type { ICredentialService } from "#src/credential/credential.js";

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Polaris：官方账号 adapter 目录已剥离，userinfo 地址（原先取自 bigmodel/zaiProviderConfig）
// 就地内联为常量解析，401 归因逻辑本身是通用流程，必须保留。
function resolveBigModelUserinfoUrl(env: NodeJS.ProcessEnv): string {
  return (
    readEnv(env, "BIGMODEL_OAUTH_USERINFO_URL") ??
    buildBigModelApiUrl(env, "/api/biz/customer/getCustomerInfo")
  );
}

function resolveZaiUserinfoUrl(env: NodeJS.ProcessEnv): string {
  return readEnv(env, "ZAI_OAUTH_USERINFO_URL") ?? buildRuntimeZaiOAuthUrl(env, "/api/oauth/userinfo");
}

import {
  isSameOAuthAccountMaterial,
  type OAuthAccountMaterial,
} from "#src/oauth/repo/oauthCredentialRepo.js";

function tryResolveHttpUrl(resolve: () => string | URL): URL | null {
  try {
    const url = new URL(resolve());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// Polaris：保持 enterprise 的精确路径白名单（三条身份接口 + userinfo）。
// 上游 v3.16.2 改为 /api/biz/、/api/pay/ 前缀匹配，但本仓官方端点已收敛到自有网关
// （nimbus），前缀匹配会把自有网关上 API key 流量的 401 误判成 OAuth 登录凭据失效。
const OAUTH_BUSINESS_PATHS = [
  "/api/biz/customer/getCustomerInfo",
  "/api/biz/subscription/enterprise/v2/pricing",
  "/api/biz/team/subscribe/product/querySubscribeDetail",
] as const;

async function isCurrentBusinessOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const authorization = options.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return false;

  const provider = await options.credentialService.load("oauth:active_provider");
  if (!(await isOAuthBusinessRequest({ ...options, provider }))) return false;

  const accessToken = (
    await options.credentialService.load(`oauth:${provider}:access_token`)
  )?.trim();
  if (!accessToken || (authorization !== accessToken && authorization !== `Bearer ${accessToken}`))
    return false;
  // 读取磁盘期间可能切换平台，不能拿上一平台残留 token 的 401 清理当前登录。
  return (await options.credentialService.load("oauth:active_provider")) === provider;
}

export async function isOAuthBusinessRequest(options: {
  input: string | URL;
  credentialService?: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
  provider?: string | null;
}): Promise<boolean> {
  const provider =
    options.provider ?? (await options.credentialService?.load("oauth:active_provider"));
  if (provider !== BIGMODEL_PROVIDER_ID && provider !== ZAI_PROVIDER_ID) return false;
  const env = options.env ?? process.env;
  const requestUrl = tryResolveHttpUrl(() => options.input);
  if (!requestUrl) return false;
  const urls =
    provider === BIGMODEL_PROVIDER_ID
      ? [
          ...OAUTH_BUSINESS_PATHS.map((path) => () => buildBigModelApiUrl(env, path)),
          () => resolveBigModelUserinfoUrl(env),
        ]
      : [
          ...OAUTH_BUSINESS_PATHS.map((path) => () => buildRuntimeZaiBusinessUrl(env, path)),
          () => resolveZaiUserinfoUrl(env),
        ];
  return urls.some((resolve) => {
    const expected = tryResolveHttpUrl(resolve);
    return (
      expected !== null &&
      requestUrl.origin === expected.origin &&
      requestUrl.pathname === expected.pathname
    );
  });
}

/** Host 私有的只读身份核验材料，不进入 RPC、配置或日志。 */
export async function resolveOAuthBusinessCredentialValidationRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string; authorization: string; emptyBodyMeansInvalid: boolean } | null> {
  const provider = await options.credentialService.load("oauth:active_provider");
  if (provider !== BIGMODEL_PROVIDER_ID && provider !== ZAI_PROVIDER_ID) return null;
  if (!(await isCurrentBusinessOAuthCredentialRequest(options))) return null;
  if ((await options.credentialService.load("oauth:active_provider")) !== provider) return null;
  const env = options.env ?? process.env;
  const url = tryResolveHttpUrl(() =>
    provider === BIGMODEL_PROVIDER_ID
      ? buildBigModelApiUrl(env, "/api/biz/customer/getCustomerInfo")
      : buildRuntimeZaiBusinessUrl(env, "/api/biz/customer/getCustomerInfo"),
  );
  if (!url) return null;
  const token = options.headers
    .get("authorization")!
    .trim()
    .replace(/^Bearer\s+/i, "");
  return {
    url: url.toString(),
    // 两平台 customerInfo 都要求裸业务 token；加 Bearer 会把格式拒绝误判成登录失效。
    authorization: token,
    // BigModel 注销后 customerInfo 返回零字节200；不扩散到 ZAI 或任意空业务响应。
    emptyBodyMeansInvalid: provider === BIGMODEL_PROVIDER_ID,
  };
}

export async function isCurrentOAuthBusinessCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  return isCurrentBusinessOAuthCredentialRequest(options);
}

/** 只识别同一主会话的关联业务 JWT；不把 PAT 或双 JWT 请求的失败解释为关联失效。 */
export async function resolveAssociatedOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  loadMaterial: () => Promise<OAuthAccountMaterial | null>;
  env?: NodeJS.ProcessEnv;
}): Promise<OAuthAccountMaterial | null> {
  if (
    !(await isOAuthBusinessRequest({
      input: options.input,
      provider: BIGMODEL_PROVIDER_ID,
      env: options.env,
    }))
  )
    return null;
  const authorization = options.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const material = await options.loadMaterial();
  if (!material || material.loginProvider === BIGMODEL_PROVIDER_ID) return null;
  const token = material.accessToken.trim();
  if (!token || (authorization !== token && authorization !== `Bearer ${token}`)) return null;
  return isSameOAuthAccountMaterial(material, await options.loadMaterial()) ? material : null;
}

// 这里只判定候选请求；实际退出须由 OAuthService 在会话变更队列内复核，不能依赖异步旧快照。
export async function isCurrentOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const authorization = options.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return false;
  const currentJwt = (await options.credentialService.load("zcodejwttoken"))?.trim() ?? "";
  if (currentJwt && authorization === `Bearer ${currentJwt}`) return true;
  return isCurrentBusinessOAuthCredentialRequest(options);
}
