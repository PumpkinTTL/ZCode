import { app } from "electron";
import { join } from "node:path";
import { ZCODE_ENV } from "@zcode/shared";

export function resolveZCodeBuiltinProviderConfigFilePath(options?: {
  readonly appPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isPackaged?: boolean;
  readonly resourcesPath?: string;
}): string {
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  // 打包版忽略机器环境变量残留（ZCODE_BUILTIN_PROVIDER_CONFIG_FILE）：装了官方 ZCode
  // 的开发机会残留 3.14.4 的 z.ai 内置配置快照路径，优先级高于随包配置会把整条模型/
  // 供应商链改道上游（rev30 事故同型）。env 覆盖仅 dev 联调生效，随包配置恒为准。
  const explicitPath = isPackaged
    ? undefined
    : (options?.env ?? process.env)["ZCODE_BUILTIN_PROVIDER_CONFIG_FILE"]?.trim();
  if (explicitPath) return explicitPath;
  if (isPackaged) {
    return join(
      options?.resourcesPath ?? process.resourcesPath,
      "config/provider/zcode-builtin.json",
    );
  }
  // 开发态没有 resources 复制步骤，必须与构建注入的产品环境读取同一份源文件。
  const filename = ZCODE_ENV === "production" ? "zcode-builtin.json" : "zcode-builtin.test.json";
  return join(options?.appPath ?? app.getAppPath(), "../../config/provider", filename);
}
