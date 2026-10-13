// @vitest-environment jsdom

import { Fragment, createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import type { IPlatformService, WebRemoteControlStatus } from "@zcode/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { useWebRemoteControlStatus } from "@/hooks/useWebRemoteControlStatus.js";

/**
 * 同一窗口内 Root / WorkspaceSidebar / WorkspaceWebRemoteControlTrigger 三处会同时挂载
 * `useWebRemoteControlStatus`。这里锁住「一份共享订阅」的语义：一次初始同步 + 每秒一次 IPC，
 * 而不是每处各跑一条 1s 轮询。
 */
function makePlatform() {
  const handlers = new Set<(status: WebRemoteControlStatus) => void>();
  const statusMock = vi.fn(async (): Promise<WebRemoteControlStatus> => ({ status: "idle" }));
  const platform = {
    getWebRemoteControlStatus: statusMock,
    onWebRemoteControlStatusChanged: (handler: (status: WebRemoteControlStatus) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  } as unknown as IPlatformService;
  return {
    platform,
    statusMock,
    push(status: WebRemoteControlStatus) {
      for (const handler of handlers) {
        handler(status);
      }
    },
    handlerCount: () => handlers.size,
  };
}

function StatusProbe() {
  const status = useWebRemoteControlStatus();
  return createElement("span", { "data-status": status.status });
}

function ThreeConsumers() {
  return createElement(
    Fragment,
    null,
    createElement(StatusProbe),
    createElement(StatusProbe),
    createElement(StatusProbe),
  );
}

function renderStatusConsumers(platform: IPlatformService) {
  return render(createElement(PlatformProvider, { platform }, createElement(ThreeConsumers)));
}

function readRenderedStatuses(container: HTMLElement): string[] {
  return [...container.querySelectorAll("span[data-status]")].map(
    (element) => element.getAttribute("data-status") ?? "",
  );
}

describe("useWebRemoteControlStatus shared polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("三处同时挂载只有一条 1s 轮询：1 次初始同步 + 每秒 1 次 IPC", async () => {
    const { platform, statusMock } = makePlatform();
    const { container } = renderStatusConsumers(platform);
    await act(async () => {});

    expect(statusMock).toHaveBeenCalledTimes(1);

    // 按真实节奏逐秒推进（每次之间让上一次 IPC 落地）：
    // 如果在同一个 tick 里连跳 3 次表，in-flight 去重会让它们只发 1 次请求，那是防并发叠加，不是丢节拍。
    for (let second = 0; second < 3; second += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }

    // 3s 内：初始 1 次 + 3 次轮询。过去三处各跑一条表 = 3×(1+3) = 12 次。
    expect(statusMock).toHaveBeenCalledTimes(4);
    expect(readRenderedStatuses(container)).toEqual(["idle", "idle", "idle"]);
  });

  it("main 推送的事件对全部订阅者同时生效", async () => {
    const { platform, push, handlerCount } = makePlatform();
    const { container } = renderStatusConsumers(platform);
    await act(async () => {});

    // 事件推送只订阅一次（不是每处一份）。
    expect(handlerCount()).toBe(1);

    await act(async () => {
      push({ status: "running", sessionId: "session-1" });
    });

    expect(readRenderedStatuses(container)).toEqual(["running", "running", "running"]);
  });

  it("最后一个订阅者卸载后停表并解除事件订阅；重新挂载立刻再同步一次", async () => {
    const { platform, statusMock, handlerCount } = makePlatform();
    const { unmount } = renderStatusConsumers(platform);
    await act(async () => {});
    expect(statusMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(handlerCount()).toBe(0);

    renderStatusConsumers(platform);
    await act(async () => {});
    expect(statusMock).toHaveBeenCalledTimes(2);
    expect(handlerCount()).toBe(1);
  });

  it("enabled=false 的消费方不订阅、也不触发 IPC", async () => {
    const { platform, statusMock, handlerCount } = makePlatform();
    function DisabledProbe() {
      const status = useWebRemoteControlStatus({ enabled: false });
      return createElement("span", { "data-status": status.status });
    }
    const { container } = render(
      createElement(PlatformProvider, { platform }, createElement(DisabledProbe)),
    );
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(readRenderedStatuses(container)).toEqual(["idle"]);
    expect(statusMock).not.toHaveBeenCalled();
    expect(handlerCount()).toBe(0);
  });
});
