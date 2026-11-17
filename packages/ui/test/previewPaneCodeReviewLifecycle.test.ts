// @vitest-environment jsdom
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

// Node 25 自带一个空的 native localStorage，会遮蔽 jsdom 的实现（getItem 不存在），
// PreviewPane 的 readLastSelectedEditorId 在首次渲染就会抛 TypeError。这里装回内存实现。
const localStorageValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageValues.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageValues.delete(key);
    },
    clear: () => {
      localStorageValues.clear();
    },
  },
});

const mocks = vi.hoisted(() => {
  const fileService = {
    readTextFile: vi.fn(async () => ({
      path: "/workspace/src/app.ts",
      content: "export const value = 1;",
      offset: 0,
      bytesRead: 23,
      totalBytes: 23,
      truncated: false,
      isBinary: false,
    })),
  };
  return {
    fileService,
    services: { fileService },
    platform: {
      getInstalledEditors: vi.fn(async () => []),
      openInEditor: vi.fn(async () => ({ success: false })),
      openInFileManager: vi.fn(async () => ({ success: false })),
    },
  };
});

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => mocks.platform,
}));

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServices: () => mocks.services,
}));

vi.mock("@/hooks/useWorkspaceOpenInEditorTarget.js", () => ({
  useWorkspaceOpenInEditorTarget: () => ({
    isRemoteWorkspace: false,
    remoteTarget: undefined,
  }),
}));

vi.mock("@/hooks/useFileContextActions.js", () => ({
  useFileContextActions: () => ({
    copyAbsolutePath: vi.fn(),
    copyRelativePath: vi.fn(),
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: <T,>(selector: (state: Record<string, unknown>) => T) =>
    selector({
      codePreviewSettings: {
        darkTheme: "github-dark",
        fontSizePx: 12,
        lightTheme: "github-light",
        showLineNumbers: true,
        wrapLongLines: false,
      },
      theme: "light",
    }),
}));

vi.mock("@/previewPaneContent.js", () => ({
  PreviewPaneContent: ({
    codeComments,
  }: {
    codeComments: readonly unknown[];
  }) =>
    createElement("div", {
      "data-code-comment-count": String(codeComments.length),
    }),
}));

describe("PreviewPane code-review lifecycle", () => {
  afterEach(() => {
    mocks.fileService.readTextFile.mockClear();
  });

  it("keeps the disabled Composer comment snapshot stable while opening a model review", async () => {
    const { PreviewPane } = await import("@/PreviewPane.js");
    const view = render(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(PreviewPane, {
          onClose: vi.fn(),
          source: {
            type: "code-review",
            title: "app.ts",
            path: "/workspace/src/app.ts",
            workspacePath: "/workspace",
            review: {
              requestId: "review-1",
              title: "模型评论",
              body: "这里需要检查。",
              startLine: 1,
              endLine: 1,
            },
          },
        }),
      ),
    );

    await waitFor(() => {
      expect(mocks.fileService.readTextFile).toHaveBeenCalledTimes(1);
    });
    expect(view.container.querySelector("[data-code-comment-count='0']")).not.toBeNull();
    view.unmount();
  });
});
