# Polaris 内存/性能审计（2026-10-13）

审计范围：`packages/desktop/src/{main,host,renderer,scheduler}`、`packages/services/src`、
`packages/ui/src` 的源码（不含 node_modules / dist / out）。

背景测量：运行时 11 个 electron 进程 ≈ 1.8GB、13 个 node 进程 ≈ 1.9GB。

## 已修

| 项 | 位置 | 改动 |
| --- | --- | --- |
| 日志逐行同步 syscall | `packages/desktop/src/main/logger.ts` | `write()`/`writeDedicated()` 曾对每行日志 `getLogDir()` + `mkdirSync`；改按目录缓存「已确保存在」。高频日志时每条日志 2–3 次同步文件系统调用归零。 |
| Shiki highlighter 无界缓存 | `packages/ui/src/lib/shikiHighlighter.ts` | 每个 (theme, language) 一份独立 Shiki 实例（自带 grammar + wasm 上下文），无上限。封顶 24 + 命中续期（原先不续期 = FIFO）。 |
| 飞书用户显示名缓存无界 | `packages/services/src/bots/providers/feishuProvider.ts` | 过期条目只覆盖不删除，bot Host 常驻累积。封顶 2000。 |
| 应用图标缓存无界 | `packages/desktop/src/main/applicationIcons.ts` | cacheKey 来自模型输入的应用 locator，值含 base64。封顶 256。 |
| ARMS RumSDK 空转代码 | `packages/desktop/src/main/browserPerfLoadNudge.ts`（已删） | 为已移除的 ARMS RUM SDK 服务的注入脚本：每个窗口 did-finish-load / dom-ready 后注入 JS，以 25ms 间隔最多轮询 80 次等待 `window.RumSDK`，而 SDK 早已移除（全仓仅此处引用它）。纯空转，已删除。 |

## 死代码清理（同轮，见 commit dd80312d）

70 个文件 / 10,529 行，全部经「零生产引用 + 不在 barrel/entry/exports +
删除后 typecheck 与全量测试绿」三重验证：

- `packages/ui/src/components/ai-elements/` 16 个零引用组件（含 `model-selector.tsx`，
  其 provider 联合类型里还带着上游 `zai-coding-plan` / `zhipuai`）。
- `packages/ui/src/lib/` 22 个零引用模块 + 13 个只测死代码的测试。
- `packages/services/src/` 6 个模块（fileChangeTracker、continuousStreamCoalescer、
  codexConfigToml、accountProjectTokenClient、toolPlanAdapter、usageStatsConfig）+
  4 个对应测试。其中 `fileChangeTracker` 每条 turn 存整份文件 before/after 字符串、
  无上限——正是审计里标注的「待接线大对象」。
- `packages/desktop/src/main/mcpUserDirectory/{claude,opencode,toml}.ts`。
- `packages/shared/src/platformUpdate.ts`（与活文件 `update.ts` 重复）。

**扫描盲区提醒**：`packages/ui/package.json` 的 `exports` 里有动态入口
（`./e2e-store-bridge` → `lib/e2eStoreBridgeBootstrap.ts`、`./conversation-share-readonly` 等），
静态 grep 会把它们误判为死代码——复核时必须排除。

## 结构性结论：node 侧 1.9GB 的主因

**不是单点泄漏，是「每 workspace 一棵常驻 agent 进程树」。**

`createZCodeAgentService`（`packages/services/src/node.ts:1850`）实例化 3 个
`ZCodeAgentProcessManager`：

- **主 lane**：无 `idleTimeoutMs` → 进程永不回收
- **plugin lane**：无 `idleTimeoutMs` → 进程永不回收
- **mcp-status lane**：有 5 分钟 idle 回收（`zcodeAgentService.ts:1206`）

`zcodeAgentProcessManager.ts:600` 的语义是「未配置 idleTimeoutMs 就永不回收」。
于是开过 N 个 workspace，就常驻 N 棵 agent 进程树（每个 agent 自身还是 Node 进程，
还会带起其下的 MCP 子进程）。

回收机制本身是安全的（`zcodeAgentProcessManager.ts:632-670`）：只在
「无在飞 RPC + 存储启动完成 + 仍是当前活跃实例」时回收，到点有请求在飞就跳过、
等下次归零重新计时；回收归因为 `expected/idle-timeout`，不会被监控当崩溃。

**为什么不直接改**：给主 lane 配 idle 回收对用户是可感知的行为变化（进程被回收后
下次发消息要重新拉起 agent，首次响应变慢、会话热状态丢失）。这属于核心执行链路，
按要求「不触碰核心功能」——需要站长确认后再动。

改动方式（待批准，两处各一行）：

```ts
// zcodeAgentService.ts，主 lane 构造处
const processManager = new ZCodeAgentProcessManager({
  ...,
  idleTimeoutMs: options?.mainLaneIdleTimeoutMs ?? <值待定>,
});
```

值的选择要权衡：太短影响 UX（频繁重启 agent），太长省不下内存。
参考 mcp-status 用的 5 分钟；主 lane 建议 15–30 分钟起步。

## 未修（按风险排序，均待站长决策）

### 高

**1. `taskRealtimeBus.ts` — `streamBatches` 在 host 卸载时不清理（真泄漏）**

`unregisterHost`（:193）释放 leases / sessionRoutes / ownerCommands，但不碰
`streamBatches`；bundle 只在 run 收到 `event.terminal` 时才删除（:528、:553）。
任务被 kill 或 Host 崩溃而没有 terminal 事件时，该 batch 连同最多 512KB
replay 缓冲（`STREAM_MIRROR_MAX_REPLAY_BYTES`）永久留在 main 进程。

同文件 `replayInitializedHostIds`（:84）也随 host 重连累积、无淘汰。

修复方式：`unregisterHost` 里补一遍「删掉 ownerHostId 等于该 host 的 batch」。
风险：需要确认 host 重连后是否依赖旧 batch 的 replay——若依赖，误删会导致
重连后历史流缺口。**动前必须读懂 replay 语义并跑 taskRealtimeBus.test.ts。**

**2. `conversationProjectionStore.ts` — `mergeOlderRows` 把历史行无上限前插**

`TURN_NAVIGATOR_HYDRATION_MAX_PAGES = 48` × 200 行 ≈ 最多 9600 行/ store。
配合 keep-warm 30s 延迟释放（`sessionDataLayer.ts:32`），多窗格/多 workspace
切换时所有关闭过的 store 在 30 秒内都还活着。历史越长的会话常驻行数越大。

风险：改上限会改变「往回翻能看到多远」的用户可见行为。

**3. `useWebRemoteControlStatus.ts` — 1s 轮询 × 3 处同时挂载**

`Root.tsx:503`、`WorkspaceSidebar.tsx:695`、`WorkspaceWebRemoteControlTrigger.tsx:136`
同窗同时存活 = 每秒 3 次 IPC + 3 组状态对象逐字段比较。已有事件推送兜底，
轮询未按事件降频。可改为「事件驱动 + 低频兜底（如 30s）」。
风险：远程控制状态更新延迟感知，属产品可感知项。

### 中

**4. `genUi.ts` — 每次读 `widgetState` 全量 `structuredClone`**
`api.get widgetState` getter 每次访问都克隆；`update()` 也做一次并 dispatch 事件。
宿主 context 变更频繁（size/theme 变化即触发），无频控/脏检查。
风险：第三方 GenUI widget 的状态语义，改错会让 widget 读到过期状态。

**5. `browserGuestManager.ts:1763` — 截图 base64 往返**
同一张 PNG 在 surface → base64 → data URL 之间多次完整复制；截图是 CUA/browser-use
高频操作。**风险高，不建议动**（截图正确性关键路径）。

**6. `useDeveloperToolsVisibility.ts` — 1s 轮询 localStorage**
每秒钟读 + JSON 解析；注释自认已有 storage/focus/visibilitychange 三条事件兜底。
可直接降频或去掉轮询，风险低——但属独立小项，未单独提交。

**7. `useGlobalTaskList.ts` — 渲染期同步 JSON.stringify**
每次 store 更新（每次 dispatch）都跑 2–3 次 `JSON.stringify` + `localeCompare` 排序。
任务流刷新期间是每帧重复序列化。可加 `useMemo`。风险低。

**8. `resourceManagerHostSampling.ts` — 采样缓存依赖调用方清理**
`lastHostResults` 保存每个 Host 完整进程列表，靠 `forgetHostResourceUsage` 清理。
当前调用点齐全，属结构性脆弱（未来漏调即泄漏），非现行 bug。

**9. `processResourceSampler.ts` / `windowsProcessListAsync.ts` — 资源管理器每秒起 PowerShell**
`ResourceManagerApp.tsx:44` 默认 1s 刷新，Windows 上每次 `execFile("powershell.exe",
Get-CimInstance Win32_Process)`（~百 ms 级子进程 + 全机进程表）。
只在资源管理器窗口打开时，但打开即 1Hz 重活。可提高默认间隔。

### 低（记录备查）

- `cuaPermissionDragPanel.ts:70` — 150ms 定时器，先做重活（读 bounds + 显示器信息）再去重。仅在权限引导开启期间活跃。
- `ConversationStatusPanel.tsx:1060,1373,1470` — 三个独立 1s 计时器，同一面板同秒 3 次父组件 setState。
- `desktopNotifications.ts` — 去重 Map 的清理依赖后续通知流量；量级小。
- `desktopOAuthDeepLink.ts` — 两个模块级容器靠 5 分钟 setTimeout 清理；登录频率低。
- `feishuProvider.ts` — `accessTokenCache` 有 TTL 但无条数上限（量级远小于已修的 display name 缓存）。
- `fileChangeTracker.ts` — 每轮快照存整份文件 before/after 字符串，无上限；当前无生产调用点（死代码/待接线）。
- `pendingCommandRegistry.ts` — 有 24h TTL + pruneExpired，规模受控。

## 已排除（审计确认无问题）

- **mermaid**：rolldown 已代码分割成懒加载 chunk（97KB 总量），不存在「74MB 静态导入」。
- **ConversationRowPool**：`WeakRef` + `FinalizationRegistry` 有界，无泄漏。
- **shiki tokensCache**：早有 300 上限 LRU。
- **processTreeWaiter 25ms 轮询**：只在杀进程树期间运行，有 exit 事件 + deadline 收口，必然 clearInterval。
- **遥测栈**：OTLP 端点未注入时 `buildAgentTelemetrySpawnEnv` 直接返回空、SDK 都不 import；
  `crashReporter` 配 `uploadToServer: false`；CLI 侧同口径。构建与 CI 均不注入。
- **i18n 双语言**：`IntlProvider` 静态 import zh-CN + en-US 各约 330KB 源码
  （renderer 侧 × 11 个窗口有放大）。**惰性化可行但需动 i18n 装载链路**，
  收益 ~660KB/窗口，风险中等——列为可选项，未做。
