/**
 * 忘记密码表单（Polaris 自有业务）：WelcomeScreen 登录卡的找回密码形态。
 *
 * 两步流：① 邮箱申请重置码（后端防枚举：无论邮箱是否存在都返回成功同文案，
 * 因此前端直接进第二步，不泄露邮箱是否注册）；② 重置码 + 新密码提交，成功后
 * toast 并回落登录 Tab 用新密码登录。
 */
import { useCallback, useState } from "react";
import {
  Loader2Icon,
  LockIcon,
  MailIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  AuthModeHeading,
  BackToLoginButton,
  EMAIL_PATTERN,
  isStrongPassword,
  LoginTextField,
} from "./welcomeAuthShared.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";

export function ForgotPasswordForm({ onBackToLogin }: { onBackToLogin: () => void }) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequest = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail) || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 后端防枚举：邮箱不存在也返回成功同文案——不向前端泄露是否存在，
      // 直接进第二步（用户拿不到码自然会回来重填）。
      await providerQuotaService.forgotPassword(trimmedEmail);
      setStep("reset");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }, [email, busy, providerQuotaService]);

  const handleReset = useCallback(async () => {
    const trimmedCode = code.trim().replace(/\s+/g, "");
    if (busy) return;
    if (!isStrongPassword(newPassword)) {
      setError(intl.formatMessage({ id: "login.errPasswordWeak" }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(intl.formatMessage({ id: "login.errPasswordMismatch" }));
      return;
    }
    if (trimmedCode.length !== 6) {
      setError(intl.formatMessage({ id: "login.errResetCode" }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await providerQuotaService.resetPassword({
        email: email.trim(),
        code: trimmedCode,
        newPassword,
      });
      toast(intl.formatMessage({ id: "login.resetSuccess" }));
      onBackToLogin();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setBusy(false);
    }
  }, [email, code, newPassword, confirmPassword, busy, providerQuotaService, intl, onBackToLogin]);

  return step === "request" ? (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void handleRequest();
      }}
    >
      <AuthModeHeading
        title={intl.formatMessage({ id: "login.forgotHeading" })}
        description={intl.formatMessage({ id: "login.forgotStep1Description" })}
      />
      <LoginTextField
        id="welcome-nimbus-forgot-email"
        label={intl.formatMessage({ id: "login.email" })}
        icon={<MailIcon className="size-4" aria-hidden="true" />}
      >
        <Input
          id="welcome-nimbus-forgot-email"
          type="email"
          className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
          value={email}
          autoComplete="email"
          placeholder={intl.formatMessage({ id: "login.emailPlaceholder" })}
          disabled={busy}
          autoFocus
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
        />
      </LoginTextField>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <Button
          type="submit"
          className="h-11 w-full rounded-lg text-ui-base"
          size="lg"
          disabled={!EMAIL_PATTERN.test(email.trim()) || busy}
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.forgotSendCode" })}
        </Button>
        <BackToLoginButton onBackToLogin={onBackToLogin} disabled={busy} />
      </div>
    </form>
  ) : (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void handleReset();
      }}
    >
      <AuthModeHeading
        title={intl.formatMessage({ id: "login.forgotHeading" })}
        description={intl.formatMessage({ id: "login.forgotStep2Description" })}
      />
      <LoginTextField
        id="welcome-nimbus-reset-code"
        label={intl.formatMessage({ id: "login.resetCode" })}
        icon={<ShieldCheckIcon className="size-4" aria-hidden="true" />}
      >
        <Input
          id="welcome-nimbus-reset-code"
          className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
          value={code}
          inputMode="numeric"
          autoFocus
          placeholder={intl.formatMessage({ id: "login.resetCodePlaceholder" })}
          disabled={busy}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
        />
      </LoginTextField>
      <LoginTextField
        id="welcome-nimbus-reset-password"
        label={intl.formatMessage({ id: "login.newPassword" })}
        icon={<LockIcon className="size-4" aria-hidden="true" />}
        hint={intl.formatMessage({ id: "login.passwordHint" })}
      >
        <Input
          id="welcome-nimbus-reset-password"
          type="password"
          className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
          value={newPassword}
          autoComplete="new-password"
          placeholder={intl.formatMessage({ id: "login.passwordPlaceholder" })}
          disabled={busy}
          onChange={(event) => {
            setNewPassword(event.target.value);
            setError(null);
          }}
        />
      </LoginTextField>
      <LoginTextField
        id="welcome-nimbus-reset-confirm"
        label={intl.formatMessage({ id: "login.confirmPassword" })}
        icon={<LockIcon className="size-4" aria-hidden="true" />}
      >
        <Input
          id="welcome-nimbus-reset-confirm"
          type="password"
          className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
          value={confirmPassword}
          autoComplete="new-password"
          placeholder={intl.formatMessage({ id: "login.confirmPasswordPlaceholder" })}
          disabled={busy}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setError(null);
          }}
        />
      </LoginTextField>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <Button
          type="submit"
          className="h-11 w-full rounded-lg text-ui-base"
          size="lg"
          disabled={busy || code.trim().length === 0 || newPassword.length === 0}
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.resetAction" })}
        </Button>
        <BackToLoginButton onBackToLogin={onBackToLogin} disabled={busy} />
      </div>
    </form>
  );
}
