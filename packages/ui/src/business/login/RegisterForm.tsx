/**
 * 注册表单（Polaris 自有业务）：WelcomeScreen 登录卡的注册形态。
 *
 * 邮箱 + 验证码必填组由服务端 register-status 的 email_required 下发（不硬编码）；
 * 客户端只做与后端同口径的形校验（用户名/密码强度/两次一致），占用/白名单/限流
 * 等语义校验交给服务端 detail 直接展示。注册成功（后端直接签发 JWT）后走与登录
 * 相同的自动开通流程进入主界面。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  LockIcon,
  MailIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import type { LoginCompleteReason } from "./welcomeAuthShared.js";
import {
  BackToLoginButton,
  EMAIL_PATTERN,
  isStrongPassword,
  LoginTextField,
  SEND_CODE_COOLDOWN_SECONDS,
  USERNAME_PATTERN,
  useNimbusLoginCompletion,
} from "./welcomeAuthShared.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 密码显隐尾部按钮（与登录表单同款；独立小函数避免整份表单重复两遍）。 */
function PasswordVisibilityToggle({
  visible,
  disabled,
  onToggle,
}: {
  visible: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <button
      type="button"
      className="absolute right-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground-subtlest outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
      aria-label={intl.formatMessage({
        id: visible ? "login.passwordHide" : "login.passwordShow",
      })}
      aria-pressed={visible}
      disabled={disabled}
      onClick={onToggle}
    >
      {visible ? <EyeOffIcon className="size-4" aria-hidden="true" /> : <EyeIcon className="size-4" aria-hidden="true" />}
    </button>
  );
}

export function RegisterForm({
  emailRequired,
  registrationClosed,
  onBackToLogin,
  onComplete,
}: {
  emailRequired: boolean;
  registrationClosed: boolean;
  onBackToLogin: () => void;
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const completeLogin = useNimbusLoginCompletion(onComplete);
  const { providerQuotaService } = useServices();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // 验证码重发冷却倒计时；清零即停表。
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((seconds) => (seconds <= 1 ? 0 : seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const canSubmit =
    Boolean(username.trim()) &&
    password.length >= 8 &&
    confirmPassword.length > 0 &&
    (!emailRequired || (Boolean(email.trim()) && emailCode.trim().length > 0)) &&
    !busy;

  const handleSendCode = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail) || sendingCode || cooldown > 0) return;
    setSendingCode(true);
    setError(null);
    try {
      await providerQuotaService.sendRegisterCode(trimmedEmail);
      setCodeSent(true);
      setCooldown(SEND_CODE_COOLDOWN_SECONDS);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setSendingCode(false);
    }
  }, [email, sendingCode, cooldown, providerQuotaService]);

  const handleRegister = useCallback(async () => {
    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();
    const trimmedCode = emailCode.trim();
    // 客户端先做与后端同口径的形校验（强度/占用等语义校验交给服务端 detail）。
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setError(intl.formatMessage({ id: "login.errUsernameFormat" }));
      return;
    }
    if (!isStrongPassword(password)) {
      setError(intl.formatMessage({ id: "login.errPasswordWeak" }));
      return;
    }
    if (password !== confirmPassword) {
      setError(intl.formatMessage({ id: "login.errPasswordMismatch" }));
      return;
    }
    if (emailRequired && !EMAIL_PATTERN.test(trimmedEmail)) {
      setError(intl.formatMessage({ id: "login.errEmailFormat" }));
      return;
    }
    if (emailRequired && trimmedCode.length === 0) {
      setError(intl.formatMessage({ id: "login.errEmailCodeRequired" }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const status = await providerQuotaService.register({
        username: trimmedUsername,
        password,
        inviteCode: inviteCode.trim() || undefined,
        email: emailRequired ? trimmedEmail : undefined,
        emailCode: emailRequired ? trimmedCode : undefined,
      });
      await completeLogin(status);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : String(registerError));
    } finally {
      setBusy(false);
    }
  }, [
    username,
    password,
    confirmPassword,
    email,
    emailCode,
    inviteCode,
    emailRequired,
    providerQuotaService,
    completeLogin,
    intl,
  ]);

  if (registrationClosed) {
    return (
      <div className="flex flex-col gap-6">
        <Alert>
          <ShieldCheckIcon className="size-4" />
          <AlertDescription>{intl.formatMessage({ id: "login.registerClosed" })}</AlertDescription>
        </Alert>
        <BackToLoginButton onBackToLogin={onBackToLogin} />
      </div>
    );
  }

  const passwordToggle = (visible: boolean, set: (next: boolean) => void): ReactNode => (
    <PasswordVisibilityToggle
      visible={visible}
      disabled={busy}
      onToggle={() => set(!visible)}
    />
  );

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void handleRegister();
      }}
    >
      <div className="space-y-4">
        <LoginTextField
          id="welcome-nimbus-reg-username"
          label={intl.formatMessage({ id: "business.quota.username" })}
          icon={<UserIcon className="size-4" aria-hidden="true" />}
        >
          <Input
            id="welcome-nimbus-reg-username"
            className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
            value={username}
            autoComplete="username"
            placeholder={intl.formatMessage({ id: "login.usernamePlaceholder" })}
            disabled={busy}
            autoFocus
            onChange={(event) => {
              setUsername(event.target.value);
              setError(null);
            }}
          />
          <p className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "login.usernameHint" })}
          </p>
        </LoginTextField>
        <LoginTextField
          id="welcome-nimbus-reg-password"
          label={intl.formatMessage({ id: "business.quota.password" })}
          icon={<LockIcon className="size-4" aria-hidden="true" />}
          trailing={passwordToggle(passwordVisible, setPasswordVisible)}
        >
          <Input
            id="welcome-nimbus-reg-password"
            type={passwordVisible ? "text" : "password"}
            className="h-11 rounded-lg bg-background pl-10 pr-12 text-ui-base"
            value={password}
            autoComplete="new-password"
            placeholder={intl.formatMessage({ id: "login.passwordPlaceholder" })}
            disabled={busy}
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
          />
          <p className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "login.passwordHint" })}
          </p>
        </LoginTextField>
        <LoginTextField
          id="welcome-nimbus-reg-confirm"
          label={intl.formatMessage({ id: "login.confirmPassword" })}
          icon={<LockIcon className="size-4" aria-hidden="true" />}
        >
          <Input
            id="welcome-nimbus-reg-confirm"
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
        {emailRequired ? (
          <>
            <LoginTextField
              id="welcome-nimbus-reg-email"
              label={intl.formatMessage({ id: "login.email" })}
              icon={<MailIcon className="size-4" aria-hidden="true" />}
            >
              <Input
                id="welcome-nimbus-reg-email"
                type="email"
                className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
                value={email}
                autoComplete="email"
                placeholder={intl.formatMessage({ id: "login.emailPlaceholder" })}
                disabled={busy}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                  setCodeSent(false);
                }}
              />
            </LoginTextField>
            <LoginTextField
              id="welcome-nimbus-reg-email-code"
              label={intl.formatMessage({ id: "login.emailCode" })}
              icon={<ShieldCheckIcon className="size-4" aria-hidden="true" />}
              trailing={
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 flex h-7 -translate-y-1/2 items-center rounded-md px-2 text-ui-xs text-primary outline-none transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
                  disabled={
                    busy || sendingCode || cooldown > 0 || !EMAIL_PATTERN.test(email.trim())
                  }
                  onClick={() => void handleSendCode()}
                >
                  {sendingCode ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : cooldown > 0 ? (
                    intl.formatMessage({ id: "login.sendCodeCountdown" }, { seconds: cooldown })
                  ) : (
                    intl.formatMessage({ id: "login.sendCode" })
                  )}
                </button>
              }
            >
              <Input
                id="welcome-nimbus-reg-email-code"
                className="h-11 rounded-lg bg-background pl-10 pr-24 text-ui-base"
                value={emailCode}
                inputMode="numeric"
                placeholder={intl.formatMessage({ id: "login.emailCodePlaceholder" })}
                disabled={busy}
                onChange={(event) => {
                  setEmailCode(event.target.value);
                  setError(null);
                }}
              />
            </LoginTextField>
            {codeSent ? (
              <p className="text-ui-xs text-foreground-subtle">
                {intl.formatMessage({ id: "login.codeSent" })}
              </p>
            ) : null}
          </>
        ) : null}
        <LoginTextField
          id="welcome-nimbus-reg-invite"
          label={intl.formatMessage({ id: "login.inviteCode" })}
          icon={<MailIcon className="size-4" aria-hidden="true" />}
        >
          <Input
            id="welcome-nimbus-reg-invite"
            className="h-11 rounded-lg bg-background pl-10 pr-3 text-ui-base"
            value={inviteCode}
            placeholder={intl.formatMessage({ id: "login.inviteCodePlaceholder" })}
            disabled={busy}
            onChange={(event) => {
              setInviteCode(event.target.value);
              setError(null);
            }}
          />
        </LoginTextField>
      </div>

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
          disabled={!canSubmit}
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.registerAction" })}
        </Button>
        <BackToLoginButton onBackToLogin={onBackToLogin} disabled={busy} />
      </div>
    </form>
  );
}
