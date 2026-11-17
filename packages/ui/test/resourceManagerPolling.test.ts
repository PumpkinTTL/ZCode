// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceManagerApp } from "@/resource-manager/ResourceManagerApp.js";

const { intl } = vi.hoisted(() => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }));
vi.mock("@/i18n/index.js", () => ({ useZCodeIntl: () => ({ intl }) }));
vi.mock("@/resource-manager/storage/StorageSection.js", () => ({ StorageSection: () => null }));
vi.mock("@/resource-manager/NetworkSection.js", () => ({ NetworkSection: () => null }));

let visibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

function setVisibility(next: "visible" | "hidden"): void {
  visibilityState = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  visibilityState = "visible";
});
describe("resource manager polling", () => {
  it("仅 CPU/内存页启用，切页和卸载停用，慢查询不叠加", async () => {
    vi.useFakeTimers();
    const getSnapshot = vi.fn(() => new Promise<never>(() => {}));
    const setSamplingActive = vi.fn();
    const view = render(createElement(ResourceManagerApp, { getSnapshot, setSamplingActive }));
    expect(setSamplingActive).toHaveBeenLastCalledWith(true);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(view.getByRole("tab", { name: "resourceManager.storage" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(view.getByRole("tab", { name: "resourceManager.network" }), {
      button: 0,
      ctrlKey: false,
    });
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
    fireEvent.mouseDown(view.getByRole("tab", { name: "resourceManager.memory" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(setSamplingActive).toHaveBeenLastCalledWith(true);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
  });

  it("窗口不可见时停采样，恢复可见立刻补一次", async () => {
    vi.useFakeTimers();
    // 这里用会 resolve 的桥，才能逐秒数调用次数（且采样完成才算一次）。
    const getSnapshot = vi.fn(
      async () =>
        ({
          sampledAt: 0,
          logicalCpuCount: 1,
          system: { cpuPercent: 0, memoryTotalBytes: 0, memoryUsedBytes: 0 },
          app: { cpuPercent: 0, memoryBytes: 0 },
          processes: [],
        }) as never,
    );
    const setSamplingActive = vi.fn();
    render(createElement(ResourceManagerApp, { getSnapshot, setSamplingActive }));
    expect(setSamplingActive).toHaveBeenLastCalledWith(true);

    for (let second = 0; second < 2; second += 1) {
      await act(() => vi.advanceTimersByTimeAsync(1_000));
    }
    expect(getSnapshot).toHaveBeenCalledTimes(3);

    // 最小化/被遮挡：停表，并通知 Host 取消在途采样。
    await act(async () => {
      setVisibility("hidden");
    });
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
    const callsWhileHidden = getSnapshot.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(getSnapshot).toHaveBeenCalledTimes(callsWhileHidden);

    // 恢复可见：立刻补一次，不用等下一个 1s。
    await act(async () => {
      setVisibility("visible");
    });
    expect(setSamplingActive).toHaveBeenLastCalledWith(true);
    expect(getSnapshot).toHaveBeenCalledTimes(callsWhileHidden + 1);
  });
});
