import { useEffect, useState } from "react";
import {
  DEVELOPER_TOOLS_STORAGE_KEYS,
  readDeveloperToolsEnabled,
} from "@/lib/developerToolsPreference.js";

const DEVELOPER_TOOLS_PREFERENCE_POLL_MS = 1_000;

/**
 * 轮询只在窗口可见时进行。
 *
 * 这里的定时器是为了感知“开发者工具开关被写到 localStorage”这一事实，
 * 而 storage 事件只在其他文档写入时触发，所以同窗口仍需轮询。
 * 但窗口隐藏（最小化/被遮挡/切到后台）时轮询没有任何意义，
 * 恢复可见时 visibilitychange 与 focus 都会立即刷新一次，行为不变。
 */
function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function useDeveloperToolsVisibility(): boolean {
  const [enabled, setEnabled] = useState(readDeveloperToolsEnabled);

  useEffect(() => {
    const refresh = () => {
      setEnabled(readDeveloperToolsEnabled());
    };
    const refreshIfVisible = () => {
      if (isDocumentVisible()) refresh();
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        DEVELOPER_TOOLS_STORAGE_KEYS.includes(
          event.key as (typeof DEVELOPER_TOOLS_STORAGE_KEYS)[number],
        )
      ) {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refresh);
    // 窗口从隐藏恢复时立即补一次，避免依赖下一次轮询。
    document.addEventListener("visibilitychange", refreshIfVisible);
    const intervalId = window.setInterval(refreshIfVisible, DEVELOPER_TOOLS_PREFERENCE_POLL_MS);
    refresh();

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(intervalId);
    };
  }, []);

  return enabled;
}
