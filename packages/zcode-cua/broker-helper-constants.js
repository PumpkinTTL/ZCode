// macOS CUA Helper 的应用名 / 显示名 / bundle id —— 与 **Helper 构建产物强耦合**：
//   1. HELPER_APP_NAME 是客户端在 resources/cua-helper/ 下查找 .app 的路径片段
//      （desktopCuaHelperInstaller / desktopRuntimeEnv）；
//   2. HELPER_BUNDLE_ID 是 LaunchServices / TCC(辅助功能授权) 的身份指纹；
//   3. HELPER_DISPLAY_NAME 出现在系统权限弹窗（"…想控制这台电脑"）。
// ★ 品牌改名（ZCode → Polaris）必须与 Helper 构建管线（CI 独立 job，产出已签名的
//   .app）同步进行，且 TCC 身份变化会让已授权用户重新授权一次：本仓单方面改常量
//   会让客户端查找/校验对不上产物（helper 缺失 → CUA fail-closed）。当前发布
//   形态不含 macOS Helper，此改名挂在「启用 macOS CUA 发布」的清单里一并做。
export const HELPER_APP_NAME = "ZCode Computer Use.app";
export const DEV_HELPER_APP_NAME = "ZCode Computer Use Dev.app";
export const HELPER_DISPLAY_NAME = "ZCode Computer Use";
export const HELPER_BUNDLE_ID = "dev.zcode.cua-helper";
export const DEV_CUA_HELPER_BUNDLE_ID = "dev.zcode.cua-helper.dev";
