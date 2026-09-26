import { getZCodeCopy } from "@zcode/i18n";

/**
 * Polaris fork：官方账号业务（Z.AI / BigModel Coding Plan 登录与 API Key 配置）已整体移除。
 *
 * 这里原先构建 4 个官方登录选项（两个 OAuth + 两个 API Key）以及授权 URL 提示、登录结果格式化。
 * 这些选项背后的登录编排已空壳化、调用必然失败，因此整个选项 UI 一并删除，只留一条稳定的
 * `/login` 提示，引导用户改用自有 provider 配置。
 */
export function loginSetupResponse(locale?: string): string {
  return getZCodeCopy(locale).tui.loginSetup.response;
}
