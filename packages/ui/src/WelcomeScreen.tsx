/**
 * WelcomeScreen —— 首启登录入口（Polaris 自有业务）
 *
 * 主路径：登录我们自己的中转站账号（用户名/密码）→ 自动取 sk- 密钥 →
 * 自动建 Nimbus 供应商并置顶，登录即可用。
 * 次入口：「使用 API Key」保留给需要手动配置第三方供应商的用户。
 */
import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { ApiKeySetupForm } from "./provider-setup/ApiKeySetupForm.js";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { provisionNimbusProvider } from "./business/quota/provisionNimbusProvider.js";
import { buildApiKeySetupDefaultModelPreferenceFromSelection } from "./provider-setup/ApiKeySetupForm.helpers.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";

interface WelcomeScreenProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

export type LoginCompleteReason = "oauth" | "apiKey" | "skip";

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <main className="relative flex h-full min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6">
      <ThemeHeroVisual className="absolute inset-0" />
      <div className="pointer-events-none absolute left-0 top-0 right-0 z-10 flex h-12 w-full items-center [app-region:drag]" />
      <section className="relative z-10 w-full flex flex-col gap-10 max-w-sm rounded-2xl border border-popover-border bg-background p-8 text-ui-base/relaxed shadow-md sm:p-10">
        <LoginPanel onComplete={onComplete} />
      </section>
    </main>
  );
}

interface LoginPanelProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

function LoginPanel({ onComplete }: LoginPanelProps) {
  const { intl } = useZCodeIntl();
  // 次入口：手动配置第三方供应商（API Key）。默认收起，主路径是 Nimbus 账号登录。
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);

  return (
    <>
      <LoginPanelHeader
        title={intl.formatMessage({ id: "login.title" })}
        description={intl.formatMessage({ id: "login.description" })}
      />

      <div className="space-y-6">
        {showApiKeyForm ? (
          <div className="space-y-3">
            <button
              type="button"
              className="text-ui-sm text-foreground-subtle hover:text-foreground"
              onClick={() => setShowApiKeyForm(false)}
            >
              ← {intl.formatMessage({ id: "login.backToNimbus" })}
            </button>
            <ApiKeySetupForm
              onCancel={() => setShowApiKeyForm(false)}
              onSaved={() => onComplete("apiKey")}
              onSkipped={() => onComplete("skip")}
            />
          </div>
        ) : (
          <NimbusLoginCard
            onComplete={onComplete}
            onUseApiKey={() => setShowApiKeyForm(true)}
          />
        )}
      </div>
    </>
  );
}

/** 主路径：Nimbus 账号登录（用户名/密码 → 自动开通供应商）。 */
function NimbusLoginCard({
  onComplete,
  onUseApiKey,
}: {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
  onUseApiKey: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService, modelSelectionService } =
    useServices();
  const markApiKeyLoginSuccess = useZCodeStore((state) => state.markApiKeyLoginSuccess);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // 登录成功 → 自动开通：sk- 密钥 → 建/更新 Nimbus 供应商 → 置顶。
      await provisionNimbusProvider({
        quota: providerQuotaService,
        providerSettings: providerSettingsService,
      });

      // 与 API Key 路径同一收尾：把新供应商的第一个模型设为偏好，进入主界面。
      const view = await modelSelectionService.getView();
      const nimbusProvider = view.providers.find(
        (provider) => provider.templateId === "nimbus",
      );
      const preferredModel = nimbusProvider
        ? buildApiKeySetupDefaultModelPreferenceFromSelection(
            view,
            nimbusProvider.providerId,
          )
        : null;
      markApiKeyLoginSuccess(preferredModel);
      await onComplete("apiKey");
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
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="welcome-nimbus-username">
          {intl.formatMessage({ id: "business.quota.username" })}
        </Label>
        <Input
          id="welcome-nimbus-username"
          value={username}
          autoComplete="username"
          disabled={busy}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="welcome-nimbus-password">
          {intl.formatMessage({ id: "business.quota.password" })}
        </Label>
        <Input
          id="welcome-nimbus-password"
          type="password"
          value={password}
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        className="h-10 w-full text-ui-base"
        size="lg"
        disabled={busy || !username.trim() || !password}
        onClick={() => void handleLogin()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {intl.formatMessage({ id: "business.quota.login" })}
      </Button>
      <Button
        type="button"
        variant="link"
        className="h-7 w-full text-ui-base text-foreground-subtle hover:text-foreground"
        onClick={onUseApiKey}
      >
        {intl.formatMessage({ id: "login.useApiKey" })}
      </Button>
    </div>
  );
}

function LoginPanelHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <LoginPanelLogo />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-ui-base/relaxed text-foreground-subtle">{description}</p>
      </div>
    </header>
  );
}

function LoginPanelLogo() {
  return (
    // 登录 logo 壳是固定深色底，边框不能跟随浅色主题 token，否则浅色主题下边框过重。
    <div
      className="relative mb-1 flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-lg/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-[rgba(255,255,255,0.1)]"
      aria-label="Polaris"
      role="img"
    >
      <ZCodeAboutLogo className="h-auto w-10" />
    </div>
  );
}
