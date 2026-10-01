import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 须在渲染进程与窗口创建之前完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// Polaris 不做远端崩溃上报，crashReporter 恒为纯本地：崩溃转储写入数据目录，
// 启动时归档到 ~/.polaris/v2/crash/archive，用户可从日志包自行导出排查。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
