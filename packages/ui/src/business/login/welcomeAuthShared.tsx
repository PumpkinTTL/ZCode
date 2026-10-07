/**
 * WelcomeScreen 登录/注册/忘记密码三个形态共享的部件（Polaris 自有业务）。
 *
 * 拆出本文件只为 max-lines 约束：登录卡内三形态各自成文件，公共的收尾 hook、
 * 字段壳、形校验口径集中一处，避免三份表单各自漂移。
 */
import { useCallback, type ReactNode } from "react";
import type { QuotaStatusResult } from "@zcode/services";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ensureOfficialDefaultModel,
  provisionNimbusProvider,
} from "@/business/quota/provisionNimbusProvider.js";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { notifyNimbusAccountChanged } from "@/business/quota/nimbusAccountState.js";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

/** 注册邮箱验证码的重发冷却（秒）。后端另有邮箱维度 3 次/小时限流兜底。 */
export const SEND_CODE_COOLDOWN_SECONDS = 60;

export type LoginCompleteReason = "login";

/** 用户名（与服务端 RegisterIn 同口径）：3-64 位字母/数字/下划线/中划线。 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
/** 邮箱结构形校验（只拦明显错误；域名白名单/临时邮箱等语义校验在服务端）。 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 与后端 validate_password_strength 同口径的形校验：≥8 位且同时含字母和数字。 */
export function isStrongPassword(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

/**
 * 登录/注册成功后的公共收尾：广播快照 → 自动开通 Nimbus 供应商 → 设偏好模型 →
 * 回调 onComplete。开通是登录后的独立步骤，**不能反过来卡住登录**（失败只记日志）。
 */
export function useNimbusLoginCompletion(
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>,
): (status: QuotaStatusResult) => Promise<void> {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService, modelSelectionService } = useServices();
  const markApiKeyLoginSuccess = useZCodeStore((state) => state.markApiKeyLoginSuccess);

  return useCallback(
    async (status: QuotaStatusResult) => {
      if (!status.loggedIn) {
        throw new Error(intl.formatMessage({ id: "business.quota.summaryLoggedOut" }));
      }

      // 广播登录成功：主界面各面（侧边栏底部 / 设置页「我的额度」）共用同一份快照，
      // 进入主界面立即可见已登录，不用等下一个获焦/重校验事件。
      notifyNimbusAccountChanged(status);

      // 登录成功 → 自动开通：复用账号已有的调用密钥 → 建/更新 Nimbus 供应商 → 置顶。
      // 失败只记日志，登录照常收尾（凭据此时已存好，用户已经是登录态）。
      let providerId: string | null = null;
      try {
        providerId = (
          await provisionNimbusProvider({
            quota: providerQuotaService,
            providerSettings: providerSettingsService,
          })
        ).providerId;
      } catch (provisionError) {
        logger.warn("[WelcomeScreen] 登录成功但供应商开通失败", {
          error: provisionError instanceof Error ? provisionError.message : String(provisionError),
        });
      }

      // 收尾：用户没有默认模型时写入官方偏好（优先 DeepSeek，否则官方第一个模型），
      // 进入主界面后新草稿的初始模型即来自它。写入失败不阻断登录。
      if (providerId) {
        const preference = await ensureOfficialDefaultModel({
          providerId,
          modelSelection: modelSelectionService,
          logger,
        });
        markApiKeyLoginSuccess(
          preference ? encodeCustomModelValue(providerId, preference.modelId) : null,
        );
      }
      await onComplete("login");
    },
    [
      intl,
      providerQuotaService,
      providerSettingsService,
      modelSelectionService,
      markApiKeyLoginSuccess,
      onComplete,
    ],
  );
}

/** 注册/忘记密码形态的小标题 + 说明（登录大标题保持不动，语境由这里交代）。 */
export function AuthModeHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1 text-center">
      <h2 className="text-ui-lg font-medium text-foreground">{title}</h2>
      <p className="text-ui-sm/relaxed text-foreground-subtle">{description}</p>
    </div>
  );
}

export function BackToLoginButton({
  onBackToLogin,
  disabled,
}: {
  onBackToLogin: () => void;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-9 w-full rounded-lg text-ui-sm text-foreground-subtle hover:text-foreground"
      disabled={disabled}
      onClick={onBackToLogin}
    >
      {intl.formatMessage({ id: "login.backToLogin" })}
    </Button>
  );
}

/** 表单字段壳：标签 + 左侧图标槽 + 可选的尾部操作（如密码显隐/发码按钮）。 */
export function LoginTextField({
  id,
  label,
  icon,
  trailing,
  children,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-ui-sm text-foreground-subtle">
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 text-foreground-subtlest">
          {icon}
        </span>
        {children}
        {trailing}
      </div>
    </div>
  );
}
