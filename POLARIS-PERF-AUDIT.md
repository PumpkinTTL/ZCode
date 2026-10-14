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

**2026-10-15 复核补证**：这不是漏配，是**类型层显式的设计约束**——
`CreateZCodeAgentServiceOptions` 以 `Omit<ZCodeAgentProcessManagerOptions, "idleTimeoutMs">`
把 idle 回收挡在 chat lane 之外，并留有注释「仅供 MCP 状态探测进程使用，**不能把空闲回收
传给 chat**」（`zcodeAgentService.ts:946-951`）。因此改动等于显式推翻这条约束（去掉 Omit +
两处传参 + 一个值），必须先拿到站长决策，不建议在清扫轮里夹带。

改动方式（待批准，两处各一行 + 去掉类型层的 Omit 约束）：

```ts
// zcodeAgentService.ts，主 lane 构造处（当前为 new ZCodeAgentProcessManager(options)）
const processManager = new ZCodeAgentProcessManager({
  ...,
  idleTimeoutMs: options?.mainLaneIdleTimeoutMs ?? <值待定>,
});
```

值的选择要权衡：太短影响 UX（频繁重启 agent），太长省不下内存。
参考 mcp-status 用的 5 分钟；主 lane 建议 15–30 分钟起步。

## 未修（按风险排序，均待站长决策）

> **2026-10-13 复盘更新**：原「高」档第 1、3 条已修，见下方「已修（本轮补记）」。
> 原第 2 条（`conversationProjectionStore`）、以及 `i18n` 惰性化、远端路径改名仍在待决。

## 已修（本轮补记，2026-10-13）

| 项 | 位置 | 改动 |
| --- | --- | --- |
| host 卸载不回收 stream mirror 批次（原「未修 1」） | `packages/desktop/src/main/taskRealtimeBus.ts` | 新增 `dropStreamBatchesForHost`，在 `releaseLeasesForHost`（先 flush，保持既有投递语义）之后回收退出 host 自己的批次，并摘掉其在其它批次里的 `replayInitializedHostIds` 记账项。hostId 由 `randomUUID()` 生成、批次键含 runId，重连不复用旧键；owner 退出时已给可见 host 发过 `stream_mirror_owner_lost` 快照失效，消费侧走快照补齐。 |
| 远控状态 1s 轮询 × 3 处同窗挂载（原「未修 3」） | `packages/ui/src/hooks/useWebRemoteControlStatus.ts` | 改为按 platform 实例隔离的共享 store（WeakMap）+ `useSyncExternalStore`：首个订阅者接事件推送并立刻同步一次，轮询取订阅者最小间隔，`syncInFlight` 防并发叠加；最后一个订阅者退订时停表、解事件订阅并复位 idle。IPC 由 3×(1+3) 降为 1+3，事件只订阅一份。 |
| 资源管理器 1Hz 采样无可见性闸门 | `packages/ui/src/resource-manager/ResourceManagerApp.tsx` | 新增 `documentVisible` 状态并入 `pollingActive`；隐藏时通知 Host `setSamplingActive(false)` 取消在途采样，恢复可见立刻补一次。（Windows 上每次采样要起一次 PowerShell 枚举全机进程。） |

验证：`typecheck` 0 错误；`architecture:check --changed` 0 违规；改动文件 oxlint 0 warning / oxfmt 通过；
点测 28/28；全量 `test:unit` **15111 passed / 87 skipped / 0 failed**（1652 文件）。
提交：`b3e20f6b`（批量采纳）、`da076bf5`（清理回归修复）。

## 已修（第三轮，2026-10-13 追问后「三类」收敛）

对「无界缓存/泄漏 + 重复 1Hz 轮询 + 高频克隆」三类逐项复核后，本轮修掉最后 3 个无界容器与最后 2 处重复/高频轮询；克隆类无新的热路径命中（判定见下）。

| 项 | 位置 | 改动 |
| --- | --- | --- |
| 展开态记忆无界 ×2 | `packages/ui/src/ToolCallBlocks/ToolLayout.tsx`、`ToolCallBlocks/renderers/create-workflow.tsx` | 两处模块级 `Map<string, boolean>` 按 toolId 只增不减（ToolLayout 的旧诊断注释自认「只增不减，先落日志」）。抽出 `packages/ui/src/lib/boundedOpenState.ts`（插入新 key 达上限时 FIFO 淘汰最老），两处接入，cap=500；`workflowWorkspaceLogbook.ts` 原有同类实现一并改用该工具。语义与既有先例一致：极老卡片的展开态被遗忘、回落默认值。新增 `packages/ui/test/boundedOpenStateStore.test.ts`（4 条）。 |
| 群消息 reaction 记忆无界 | `packages/services/src/bots/providers/groupInputReaction.ts` | `entries` 按消息 id 只增不减（每条触发 reaction 的消息一个条目），长跑 bot Host 常驻累积。FIFO 封顶 2000：被遗忘消息的迟到事件按新消息处理（需其后又过上千条消息才可能发生，代价至多一次 reaction 重放）。测试补封顶用例。 |
| 远控弹层重复 1s 轮询 | `packages/ui/src/WebRemoteControlDialog.tsx` | 弹层打开时自带 1s 定时器直连 `getWebRemoteControlStatus`，与已改的共享 store 重复：打开期间同一 IPC 每秒 2 次。改为 `useWebRemoteControlStatus({ enabled: open })` 订阅共享 store（事件推送 + 1s 轮询兜底不变），仅保留原有「本 workspace / 可复用 / idle / error」过滤；附带把「手机连接」等状态从「最迟 1s 轮询」提为事件推送即达。 |
| 飞书长连接 100ms 永久轮询 | `packages/services/src/bots/providers/feishuProvider.ts` | SDK 无 onReady，启动期 100ms 观察 OPEN 是必要；但 settle 后该定时器永不停止，仅承担「断线→reconnecting / 重连耗尽」看护——在线期间每秒 10 次唤醒常驻。settle 后重挂为 1s（`FEISHU_WEBSOCKET_CONNECTED_POLL_MS`），断线感知最多晚 1s。生命周期测试同步（settle 后 100ms 内不再触发状态变化、1s 时点触发）。 |

三类复核的「不动」判定（附证据）：

- **克隆类**：全仓 `structuredClone` / `JSON.parse(JSON.stringify)` 逐一复核，热路径仅 `genUi.ts` widgetState（维持不动，理由见下「未修·中·4」）；其余都在设置保存、导入、配置读取等冷路径。v4 流式/会话渲染无逐事件全量克隆（对话行结构共享沿用 ConversationRowPool）。
- **无界容器小项**：`subagentsContextStore.latestRequestIds`（按 workspace 计）、`composerDraftRevision.revisionByWorkspaceKey`（按 workspace 计）、`useWorkflowRunArtifactData.sessionsWithoutFieldReads`（按会话计）——量级与打开过的数量同阶，不动；`zcodeSessionStore.workspaces` 桶无删除路径属刻意「先落日志」（删除时机=产品语义，待拍板）。
- §31e 遗留三候选复查：logbook `openState` 上轮已封顶；`codeCommentContext.removedCodeCommentKeys` 与 `feishuProvider.typingReactionIds` 现均已带上限（本轮逐行确认）。
- **低危 1Hz**：`ConversationStatusPanel` 3×1s ticker（合并共享 clock 只省定时器不减渲染，且共享 clock 会被空面板保持存活——反而更差）、`useDeveloperToolsVisibility` 1s localStorage 读（微秒级 + storage/focus/visibilitychange 三条兜底）——维持不动。
- 扫描工具入仓：`scripts/audit/scan-unbounded-containers.mjs`（模块级容器「有写无删」粗筛；26 个候选逐个人工复核，本轮真无界即上表 3 个）。

验证：`typecheck` 0 错误；`architecture:check --changed` 0 违规；改动文件 oxlint 0 warning
（弹层与本测试文件在 HEAD 本就不是 oxfmt-clean 的文件，只做最小 diff、不整篇重排）；
点测（涉及 7 个测试文件）全绿、新增 5 条用例；全量 `test:unit`
**15116 passed / 87 skipped / 0 failed**（1648 文件，601s）。

### 高（仍未修）

`TURN_NAVIGATOR_HYDRATION_MAX_PAGES = 48` × 200 行 ≈ 最多 9600 行/ store。
配合 keep-warm 30s 延迟释放（`sessionDataLayer.ts:32`），多窗格/多 workspace
切换时所有关闭过的 store 在 30 秒内都还活着。历史越长的会话常驻行数越大。

风险：改上限会改变「往回翻能看到多远」的用户可见行为。

**3. `useWebRemoteControlStatus.ts` — 1s 轮询 × 3 处同时挂载 → 已修（见文首「已修（本轮补记）」）**

原状：`Root.tsx:503`、`WorkspaceSidebar.tsx:695`、`WorkspaceWebRemoteControlTrigger.tsx:136`
同窗同时存活 = 每秒 3 次 IPC + 3 组状态对象逐字段比较。
现为每窗口一份共享订阅：仍是 1s 轮询（保持感知延迟不变），但 IPC 与事件订阅都收敛为一份。
未采用「降频到 30s」方案——那会改变远控状态更新的用户可感知延迟，属产品决策。

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
