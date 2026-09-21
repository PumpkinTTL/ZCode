import { ZCODE_TELEMETRY_ENABLED } from "@zcode/shared";
import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 须在 appARMSBootstrap 之前完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// remoteCrashReporterEnabled=true 表示 ARMS 已接管远端 crash 上报，不再启动仅本地的 crashReporter。
// Polaris：远端上报跟随埋点总开关（默认关闭）——关闭时自动保留纯本地 crashReporter，
// 崩溃转储仍写入数据目录，用户可自行导出，只是不再发往官方。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(
  logger,
  ZCODE_TELEMETRY_ENABLED,
);
