import { createContext, useContext } from "react";
import type { Locale, LocalePreference } from "@zcode/shared";

/** 简易 intl 工具：根据 id 查找翻译，支持 {key} 占位符替换 */
export interface IntlInstance {
  formatMessage(descriptor: { id: string }, values?: Record<string, string | number>): string;
}

export interface IntlContextValue {
  intl: IntlInstance;
  locale: Locale;
  localePreference: LocalePreference;
  setLocale: (locale: Locale) => void;
  setLocalePreference: (localePreference: LocalePreference) => void;
}

/**
 * Context 与 hook 必须独立于 Provider 组件所在模块（IntlProvider.tsx）。
 *
 * Vite HMR 会在 locale 文案变更时重载 IntlProvider 模块；如果 Context 和 Provider
 * 定义在同一模块，Context 对象会随之换新身份，而已经挂载的旧 Provider 子树仍持有旧
 * Context，导致子级的 useZCodeIntl 读到 null 并抛错。把 Context 与 hook 放在这个不
 * 引用任何 locale 的稳定模块里，即可让 HMR 只重载 Provider 组件而保持 Context 身份不变。
 */
export const IntlContext = createContext<IntlContextValue | null>(null);

/** 获取 intl 上下文 */
export function useZCodeIntl(): IntlContextValue {
  const ctx = useContext(IntlContext);
  if (!ctx) {
    throw new Error("useZCodeIntl 必须在 ZCodeIntlProvider 内使用");
  }
  return ctx;
}
