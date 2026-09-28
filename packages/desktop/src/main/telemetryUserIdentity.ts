interface TelemetryUserIdentitySyncDeps {
  /** 设备维度 id，直接作为遥测 user.name 上报 */
  deviceMid: string;
  /** 写入遥测 user 配置 */
  setUser: (user: { name: string }) => void;
}

interface TelemetryUserIdentitySync {
  /** 将 deviceMid 写入遥测 user.name（带去重） */
  refresh: () => void;
}

/**
 * 主进程 遥测 RUM 用户身份同步：统一以 device_mid 作为 user.name 上报。
 *
 * 不写 user.id：SDK 会把 config.user.id 在事件合并时跳过、强制改写为内部随机值，
 * 无法注入；而 user.name 不受屏蔽。又因 setConfig("user", ...) 是整体替换 user 键
 * （非字段合并），这里只传 { name }，刻意不带 id，保持与 appTelemetryBootstrap.init 的
 * user.name 写法一致，避免反复覆盖。
 */
export function createTelemetryUserIdentitySync(deps: TelemetryUserIdentitySyncDeps): TelemetryUserIdentitySync {
  let lastWrittenName: string | null = null;

  function refresh(): void {
    if (deps.deviceMid === lastWrittenName) {
      return;
    }
    lastWrittenName = deps.deviceMid;
    deps.setUser({ name: deps.deviceMid });
  }

  return { refresh };
}
