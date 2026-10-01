/**
 * WelcomeScreen —— 首启登录入口（Polaris 自有业务）
 *
 * 只做一件事：登录我们自己的中转站账号（用户名/密码）→ 自动取 sk- 密钥 →
 * 自动建 Nimbus 供应商并置顶，登录即可用。
 *
 * 第三方模型（自带 API Key）不在这里配置：那是「设置 → 模型提供商」的职责，
 * 首启登录页不掺第二套供应商接入通道，避免一屏里出现两条互相不认识的登录路径。
 */
import { useCallback, useState, type ReactNode } from "react";
import {
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  LockIcon,
  SettingsIcon,
  TriangleAlertIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import {
  provisionNimbusProvider,
  resolveFirstModelPreference,
} from "./business/quota/provisionNimbusProvider.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";

interface WelcomeScreenProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
  /**
   * 关闭登录页回到主界面。
   *
   * 这个入口在「登录入口从模态弹窗收敛成整屏 WelcomeScreen」时被漏掉了：整屏接管后
   * 没有关掉它的办法，用户一旦被任何 reason（手动登录 / provider-request / 会话过期 /
   * 启动缺 provider）带到这里就再也回不到工作区。必须保留一个返回入口。
   */
  onClose?: () => void;
}

export type LoginCompleteReason = "login";

export function WelcomeScreen({ onComplete, onClose }: WelcomeScreenProps) {
  const { intl } = useZCodeIntl();
  return (
    <main className="relative flex h-full min-h-dvh items-center justify-center overflow-y-auto bg-background px-4 py-8 text-foreground sm:px-6">
      <ThemeHeroVisual className="absolute inset-0" />
      <div className="pointer-events-none absolute left-0 top-0 right-0 z-10 flex h-12 w-full items-center [app-region:drag]" />
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={intl.formatMessage({ id: "login.close" })}
          title={intl.formatMessage({ id: "login.close" })}
          // 顶部 h-12 是窗口拖拽区，这里必须显式 no-drag，否则点击会变成拖窗口。
          className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-lg text-foreground-subtle outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [app-region:no-drag]"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {/*
        登录卡是页面上唯一的一层容器：hero 渐变 → 卡片 → 字段。字段刻意用 bg-background
        而不是 bg-input，因为两个内置主题里 --color-input 与 --color-card 完全同色
        （深色都是 #2b2b2b、浅色都是 #ffffff），照默认写法字段会和卡片糊成一片。
      */}
      <section className="relative z-10 my-auto w-full max-w-md rounded-xl border border-card-border bg-card p-8 shadow-md sm:p-10">
        <div className="flex flex-col gap-7">
          <LoginHeader />
          <NimbusLoginCard onComplete={onComplete} />
        </div>
      </section>
    </main>
  );
}

function LoginHeader() {
  const { intl } = useZCodeIntl();
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      <LoginPanelLogo />
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {intl.formatMessage({ id: "login.title" })}
        </h1>
        <p className="text-ui-base/relaxed text-foreground-subtle">
          {intl.formatMessage({ id: "login.description" })}
        </p>
      </div>
    </header>
  );
}

/** 主路径也是唯一路径：Nimbus 账号登录（用户名/密码 → 自动开通供应商）。 */
function NimbusLoginCard({
  onComplete,
}: {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService, modelSelectionService } = useServices();
  const markApiKeyLoginSuccess = useZCodeStore((state) => state.markApiKeyLoginSuccess);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = Boolean(username.trim()) && Boolean(password) && !busy;

  const handleLogin = useCallback(async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const status = await providerQuotaService.login({ username, password });
      if (!status.loggedIn) {
        setError(intl.formatMessage({ id: "business.quota.summaryLoggedOut" }));
        return;
      }

      // 登录成功 → 自动开通：复用账号已有的调用密钥 → 建/更新 Nimbus 供应商 → 置顶。
      // 开通是登录后的独立步骤，**不能反过来卡住登录**：凭据此时已经存好了，用户已经是
      // 登录态。过去这里开通失败就 return，把用户永久按在登录页上（没有关闭入口时更是
      // 无法退出），这才是「登录不了」的直接原因。失败只记日志，登录照常收尾。
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

      // 收尾：把新供应商的第一个模型设为偏好，进入主界面。
      if (providerId) {
        markApiKeyLoginSuccess(
          resolveFirstModelPreference(await modelSelectionService.getView(), providerId),
        );
      }
      await onComplete("login");
    } catch (loginError) {
      // QuotaApiError 的 detail 是服务端中文文案（含限流提示），直接展示。
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  }, [
    username,
    password,
    providerQuotaService,
    providerSettingsService,
    modelSelectionService,
    markApiKeyLoginSuccess,
    onComplete,
    intl,
  ]);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void handleLogin();
      }}
    >
      <div className="space-y-4">
        <LoginTextField
          id="welcome-nimbus-username"
          label={intl.formatMessage({ id: "business.quota.username" })}
          icon={<UserIcon className="size-4" aria-hidden="true" />}
        >
          <Input
            id="welcome-nimbus-username"
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
        </LoginTextField>
        <LoginTextField
          id="welcome-nimbus-password"
          label={intl.formatMessage({ id: "business.quota.password" })}
          icon={<LockIcon className="size-4" aria-hidden="true" />}
          trailing={
            <button
              type="button"
              className="absolute right-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground-subtlest outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
              aria-label={intl.formatMessage({
                id: passwordVisible ? "login.passwordHide" : "login.passwordShow",
              })}
              aria-pressed={passwordVisible}
              disabled={busy}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? (
                <EyeOffIcon className="size-4" aria-hidden="true" />
              ) : (
                <EyeIcon className="size-4" aria-hidden="true" />
              )}
            </button>
          }
        >
          <Input
            id="welcome-nimbus-password"
            type={passwordVisible ? "text" : "password"}
            className="h-11 rounded-lg bg-background pl-10 pr-12 text-ui-base"
            value={password}
            autoComplete="current-password"
            placeholder={intl.formatMessage({ id: "login.passwordPlaceholder" })}
            disabled={busy}
            onChange={(event) => {
              setPassword(event.target.value);
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
          {intl.formatMessage({ id: "business.quota.login" })}
        </Button>
        <p className="flex items-start justify-center gap-1.5 text-center text-ui-sm text-foreground-subtlest">
          <SettingsIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {intl.formatMessage({ id: "login.providerHint" })}
        </p>
      </div>
    </form>
  );
}

/** 表单字段壳：标签 + 左侧图标槽 + 可选的尾部操作（如密码显隐）。 */
function LoginTextField({
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

function LoginPanelLogo() {
  return (
    // 登录 logo 壳是固定深色底，边框不能跟随浅色主题 token，否则浅色主题下边框过重。
    <div
      className="relative flex size-20 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-lg/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-[rgba(255,255,255,0.1)]"
      aria-label="Polaris"
      role="img"
    >
      <ZCodeAboutLogo className="h-auto w-12" />
    </div>
  );
}
