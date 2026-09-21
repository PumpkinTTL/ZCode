import {
  BIGMODEL_PROVIDER_ID,
  type ApiClient,
  resolveBigModelApiOrigin,
  resolveZaiBusinessBaseUrl,
  type ZCodeAccountAccess,
  ZAI_PROVIDER_ID,
} from "@zcode/shared";
import type { ICredentialService } from "#src/credential/credential.js";
import {
  createBigModelBizHeaders,
  copyBigModelTeamPlanProjectApiKeySecret,
  ensureBigModelTeamPlanProjectApiKey,
} from "#src/bigmodel/teamPlanApiKey.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { readApiJson } from "#src/providers/api/apiJson.js";
import type { RemoteCustomerInfo } from "./accountProviderApiTypes.js";

const log = createServiceLogger("account-provider-team-plan-request-key");
const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const TEAM_PLAN_RUNTIME_KEY_REQUEST_TIMEOUT_MS = 15_000;

interface TeamPlanRequestKeyDependencies {
  readonly apiClient: ApiClient;
  readonly credentialService?: Pick<ICredentialService, "load">;
  readonly access: Extract<ZCodeAccountAccess, { planKind: "team-coding-plan" }>;
}

/**
 * Polaris fork：官方 Coding Plan 订阅 provider 已移除，这里就地保留 z.ai 业务接口所需的最小鉴权头。
 * Z.ai 的 provider connection 把 access_token 持久化为业务 JWT，业务接口要求
 * Authorization 直接传 token（不加 Bearer，也不能用模型 API key），与 bigmodel
 * 的 createBigModelBizHeaders 同形。接自有套餐后如鉴权方式变化，改这里即可。
 */
function createZaiLoginAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

export async function resolveAccountTeamPlanRuntimeApiKey(
  params: TeamPlanRequestKeyDependencies,
): Promise<string | null> {
  const { family, organizationId, projectId } = params.access;
  const oauthProviderId = family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
  const token =
    (await params.credentialService?.load(`oauth:${oauthProviderId}:access_token`))?.trim() ?? "";
  if (!token) {
    log.warn(undefined, "Team Plan runtime key projection skipped: OAuth token missing", {
      family,
      projectId,
    });
    return null;
  }
  const zcodeJwtToken = (await params.credentialService?.load(ZCODE_JWT_TOKEN_KEY))?.trim() ?? "";
  if (family === "bigmodel" && zcodeJwtToken && token === zcodeJwtToken) {
    // BigModel /api/biz 只接受登录 access token，不能使用旧版本误存的 ZCode JWT。
    log.warn(undefined, "Team Plan runtime key projection skipped: stale zcode JWT token", {
      family,
      projectId,
    });
    return null;
  }

  const host =
    family === "zai"
      ? resolveZaiBusinessBaseUrl(process.env)
      : resolveBigModelApiOrigin(process.env);
  const headers =
    family === "zai" ? createZaiLoginAuthHeaders(token) : createBigModelBizHeaders(token);
  const customerInfo = await readApiJson<{ data?: RemoteCustomerInfo }>(
    params.apiClient,
    `${host}/api/biz/customer/getCustomerInfo`,
    {
      method: "GET",
      timeoutMs: TEAM_PLAN_RUNTIME_KEY_REQUEST_TIMEOUT_MS,
      headers,
    },
  ).catch((error: unknown) => {
    log.warn(undefined, "Team Plan runtime key projection customerInfo request failed", {
      family,
      projectId,
      host,
      error: normalizeTeamPlanRuntimeKeyError(error),
    });
    throw error;
  });
  const organization = customerInfo.data?.organizations?.find(
    (item) => item.organizationId?.trim() === organizationId,
  );
  const hasProject = organization?.projects?.some(
    (project) => project.projectId?.trim() === projectId,
  );
  if (!hasProject) {
    log.warn(
      undefined,
      "Team Plan runtime key projection skipped: project not found in customer info",
      {
        family,
        projectId,
        organizationId,
        organizationCount: customerInfo.data?.organizations?.length ?? 0,
      },
    );
    return null;
  }

  return resolveTeamPlanProjectApiKey({
    apiClient: params.apiClient,
    authorization: token,
    family: family === "zai" ? "Z.ai" : "BigModel",
    host,
    organizationId,
    projectId,
  });
}

async function resolveTeamPlanProjectApiKey(params: {
  readonly apiClient: ApiClient;
  readonly authorization: string;
  readonly family: "BigModel" | "Z.ai";
  readonly host: string;
  readonly organizationId: string;
  readonly projectId: string;
}): Promise<string | null> {
  const { organizationId, projectId } = params;
  const teamContext = { organizationId, projectId };
  const apiKeyEntry = await ensureBigModelTeamPlanProjectApiKey({
    apiClient: params.apiClient,
    authorization: params.authorization,
    host: params.host,
    teamContext,
    timeoutMs: TEAM_PLAN_RUNTIME_KEY_REQUEST_TIMEOUT_MS,
  }).catch((error: unknown) => {
    log.warn(undefined, `${params.family} Team Plan runtime key projection api key ensure failed`, {
      projectId,
      organizationId,
      host: params.host,
      error: normalizeTeamPlanRuntimeKeyError(error),
    });
    throw error;
  });
  const apiKey = apiKeyEntry?.apiKey?.trim() ?? "";
  if (!apiKey) {
    log.warn(
      undefined,
      `${params.family} Team Plan runtime key projection skipped: project api key missing`,
      { projectId, organizationId },
    );
    return null;
  }

  const secretKey = await copyBigModelTeamPlanProjectApiKeySecret({
    apiClient: params.apiClient,
    authorization: params.authorization,
    apiKey,
    host: params.host,
    teamContext,
    timeoutMs: TEAM_PLAN_RUNTIME_KEY_REQUEST_TIMEOUT_MS,
  }).catch((error: unknown) => {
    log.warn(undefined, `${params.family} Team Plan runtime key projection api key copy failed`, {
      projectId,
      organizationId,
      host: params.host,
      error: normalizeTeamPlanRuntimeKeyError(error),
    });
    throw error;
  });
  if (!secretKey) {
    log.warn(
      undefined,
      `${params.family} Team Plan runtime key projection using api key without copied secret`,
      { projectId, organizationId, hasApiKey: true },
    );
  }
  return secretKey ? `${apiKey}.${secretKey}` : apiKey;
}

function normalizeTeamPlanRuntimeKeyError(error: unknown): {
  name: string;
  message: string;
  status?: number;
} {
  if (error instanceof Error) {
    const maybeStatus = (error as { status?: unknown }).status;
    return {
      name: error.name,
      message: error.message,
      status: typeof maybeStatus === "number" ? maybeStatus : undefined,
    };
  }
  return {
    name: typeof error,
    message: String(error),
  };
}
