import type { ZCodeAccountAccess, ZCodeProviderAccountAccess } from "@zcode/shared";

/**
 * 请求期 Account 鉴权边界（Polaris 空壳实现）。
 *
 * 官方账号体系（Z.ai / BigModel Coding Plan）已移除，当前没有任何 `zhipu-account`
 * provider，因此这里恒定表达「无可用账号请求材料」：读接口返回 null，写接口抛
 * `AccountRequestCredentialUnavailableError`，与移除前「没有账号连接」时的行为一致。
 *
 * 接口与类型保持不变；接自有账号体系时在这里实现 `IAccountRequestAuthService`
 * （把 resolver 重新接回来），调用点无需改动。
 */

export interface AccountRequestAuthMaterial {
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface AccountRequestAuthInput {
  providerId: string;
  modelId?: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
  reason: "model-request" | "off-peak" | "usage";
}

export interface AccountAccessIdentityInput {
  providerId: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
}

export class AccountRequestCredentialUnavailableError extends Error {
  constructor(readonly providerId: string) {
    super(`Account request credential is unavailable: ${providerId}`);
    this.name = "AccountRequestCredentialUnavailableError";
  }
}

/** 账号请求材料解析器的契约；接自有账号体系时由该实现驱动 `IAccountRequestAuthService`。 */
export interface AccountRequestAuthResolver {
  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

/**
 * 请求期 Account 鉴权边界。
 *
 * 服务按 Active Model 的静态 family/mode 约束，从当前账号连接解析请求材料。
 * 它不保存 Provider Config，也不提供 Registry fallback。
 */
export interface IAccountRequestAuthService {
  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

export function createAccountRequestAuthService(): IAccountRequestAuthService {
  return {
    async resolveAccessCurrent(): Promise<ZCodeAccountAccess | null> {
      return null;
    },
    async resolveCurrent(input): Promise<AccountRequestAuthMaterial> {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    },
    async assertCurrent(input): Promise<void> {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    },
  };
}
