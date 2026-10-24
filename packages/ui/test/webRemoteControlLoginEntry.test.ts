// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OAuthProviderId } from "@zcode/shared";
import { WebRemoteControlDialog } from "@/web-remote-control/index.js";

// Polaris：官方 OAuth（zai/bigmodel）登录链路与 LoginPanel 已整体砍除，
// 远控弹层的登录按钮收敛为统一入口 requestLoginEntry(undefined, "app-login")；
// 上游针对 provider 门控 / 缓存用户判定的用例随被砍链路一并删除。

// 合并后的远控弹层链路读取平台能力；本用例只钉统一登录入口行为，桩掉平台钩子
// （auth-required 状态下弹层渲染统一登录按钮）。
vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    getWebRemoteControlStatus: async () => ({ status: "auth-required" }),
  }),
  useOptionalPlatform: () => null,
}));

const state = vi.hoisted(() => ({
  loginEntryRequest: null as { id: number; providerId?: OAuthProviderId; purpose?: string } | null,
  requestLoginEntry: vi.fn(),
}));
const intl = vi.hoisted(() => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({ useZCodeIntl: () => intl }));
vi.mock("@/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("button", props, children),
}));
vi.mock("@/components/ui/dialog.js", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
  };
});
vi.mock("@/BotsDialog.js", () => ({ BotsDialog: () => null }));
vi.mock("@/BotsDialog/shared.js", () => ({ ProviderIcon: () => null }));
vi.mock("@/components/ui/ZCodeAboutLogo.js", () => ({ ZCodeAboutLogo: () => null }));

function openDialog(onOpenChange = vi.fn()) {
  state.requestLoginEntry.mockImplementation((providerId?: OAuthProviderId, purpose?: string) => {
    state.loginEntryRequest = { id: 1, providerId, purpose };
  });
  return render(
    createElement(WebRemoteControlDialog, { open: true, onOpenChange, workspacePath: "/project" }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.loginEntryRequest = null;
});

it("登录按钮关闭弹层并提交统一登录入口请求（purpose=app-login，不带 provider）", async () => {
  const onOpenChange = vi.fn();
  const view = openDialog(onOpenChange);
  fireEvent.click(await view.findByTestId("web-remote-control-login"));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(state.requestLoginEntry).toHaveBeenCalledWith(undefined, "app-login");
  expect(state.loginEntryRequest).toEqual({ id: 1, providerId: undefined, purpose: "app-login" });
});
