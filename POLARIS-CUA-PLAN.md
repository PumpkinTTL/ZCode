# Polaris Computer Use（CUA）恢复实现方案

日期：2026-10-05（2026-10-06 更新：M1/M2 已实现并实测，见审计 §26）。
状态：M0 完成（插件包入库 + 方案定档）；M1/M2 完成（自研 runtime + Windows Helper + 动作链路实测）；M3/M4 待续。
背景与判定证据见 `POLARIS-RESIDUE-AUDIT.md` §24 / §25 / §26。

## 0. 目标与范围

- 目标：Windows 先恢复**官方同款** Computer Use —— 模型面 = 官方插件 SDK（`agent.computerUse`），
  市场出现「Computer Use / 电脑控制」，装完后能真实操作桌面应用。
- 范围：只做 Windows；macOS Helper（`ZCode Computer Use.app`）闭源且形态不同，暂缓。
- 原则：**既有开源接线一律不改**（bridge / cua-broker / permission / PiP / 设置面板 / 插件
  SDK 全部原样驱动我们的实现）。新增 = `packages/zcode-cua` 的真实现（替换 placeholder）
  - Helper 进程 + dev/打包清单。

## 1. 架构与接缝（现状接线，均为仓内已存在的代码）

```
模型面   plugin(MIT, 已入库 packages/zcode-cua-plugin)
         └ setupComputerUseRuntime → Symbol.for("zcode.node-repl.computer-use-bridge")
宿主     node-repl-host/server.ts:377  createComputerUseRuntime ←【要实现的 runtime】
         node-repl-host/cua-broker.ts   会话管道(\\.\pipe\zcode-node-repl-cua-*) + token
                                        → runtime.execute(toolName,args,ctx) → CallToolResult
runtime  【实现主体】execute()：连接 helper 管道、状态/帧/索引台账
helper   【要实现的进程】windows-helper 等价物（Node，ELECTRON_RUN_AS_NODE）
         - fork 参数固定：`--socket <pipe> --parent-pid <pid>`（windowsCuaDevHelperHost.ts）
         - 启动：bind pipe → process.send({protocol:"zcode-cua-windows-dev/v1", type:"transport_ready"|"ready", socketPath, pid})
         - 服务 runtime 的 RPC + 响应健康探针（probeHelperHealth，由我们包内实现）
原生层   Phase 1 = 委托 cua-driver 0.33.3（本机已装；MIT）
         Phase 2 = 自研（koffi FFI → UIA 等系统 API；无需编译 .node）
```

固定契约（不可自主发挥，出处全在仓）：

| 边界              | 出处                                                                | 说明                                                                            |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 会话管道协议      | `cua-bridge.ts` / `cua-broker.ts`                                   | `{id,token,method,input,context}` 行协议；回 `{id,ok,result,responseMeta}`      |
| runtime 接口      | placeholder `packages/zcode-cua/index.d.ts`                         | `execute / closeSession / dispose`                                              |
| Helper fork/控制  | `windowsCuaHelperHostSupport.ts`                                    | argv、控制消息、health 探针、代际管理                                           |
| dev 接缝          | `windowsCuaDevRuntime.ts`                                           | `ZCODE_CUA_DEV_ROOT` + `zcodeCuaRuntime:{schema:1,windows:{entry,nativeAddon}}` |
| 工具语义/响应形状 | MIT 插件 `scripts/computer-use-client.mjs` + `docs/computer-use.md` | 14 工具、错误码、state_id/frame/image_ref、possibly_sent                        |

自主定义（两端都是我们，协议自拟）：runtime ↔ helper 管道内部协议。

## 2. 要写 / 已有

已有（勿动）：插件 SDK、bridge、cua-broker、permission broker 四件、helper host（dev+product）、
PiP 会话、设置页 CUA 段、placeholder 的 `.d.ts` 契约。

要写：

1. `packages/zcode-cua`（placeholder → 真实现，导出面不变）：
   - `createComputerUseRuntime`：ensureBrokerAvailable 协调、连接 `brokerSocketPath`、RPC、
     会话/帧/状态语义（对上层 SDK 的承诺从 MIT 插件与 docs 反推）。
   - `broker` 模块实现：`mintBrokerSocketPath` / `probeHelperHealth` 等。
   - `package.json` 增加 `zcodeCuaRuntime` 契约（dev 接缝）；`nativeAddon` 指向我们的
     原生访问模块（Phase 1 可为占位文件，Phase 2 = koffi FFI 模块）。
2. Helper：`packages/zcode-cua/helper/`（入口、pipe 服务端、控制消息、能力映射层）。
3. dev 联调：`ZCODE_CUA_DEV_ROOT` 指向 `packages/zcode-cua`，dev 实例实测。
4. 打包（暂缓，不阻塞 dev）：`runtime-manifest.json` 生成脚本、koffi staging、
   第三条打包清单接线（`prepare-agent-node-bundle.mjs` / `koffi-package-assets.mjs` 现有引用
   已按路径读取，产物补齐后自然接通）。

## 3. 工具保真度对照（Phase 1：cua-driver 后端）

| 官方工具                                 | cua-driver 可用面                       | Phase 1 策略                                                     |
| ---------------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| list_apps                                | `list_apps`（Lyra 实测通过）            | 直用                                                             |
| list_windows                             | 窗口管理类工具                          | 映射                                                             |
| get_app_state                            | `screenshot` + capture 绑定             | 截图态（树保真降级并如实标注）                                   |
| left_click / scroll / drag               | click / scroll（capture_id 一次性绑定） | 直用                                                             |
| type / key / paste                       | type / key / 剪贴板                     | 直用                                                             |
| set_value / select_text / perform_action | 无元素级对应                            | Phase 1 fail-closed（ACTION_UNAVAILABLE + 明确文案）；Phase 2 补 |
| request_access / stop                    | 权限/停止语义                           | 映射                                                             |

保真度如实标注：Phase 1 “能用但元素级受限”，坐标/截图工作流优先；Phase 2 = 元素树/索引/
帧台账自研（koffi → UIA）。

## 4. 里程碑

- **M1 骨架打通**：runtime 真实现 + helper + dev 接缝；验收 = dev 实例里 agent 调
  `list_apps` / `list_windows` / 截图 全链路通过（会话管道 → runtime → helper）。
- **M2 动作面**：click / type / key / paste / scroll；验收 = 让 agent 在记事本里完成
  打字并保存。
- **M3 元素面+语义**：UIA 树、索引冻结/失效校验、frame/栅格、possibly_sent 语义；
  验收 = `docs/computer-use.md` 的坐标与元素两种工作流行为一致。
- **M4 产品化**：权限面板 / PiP 联调、打包清单补齐、市场安装验收。

## 5. 风险与决策点

- **保真度**：cua-driver 以视觉/坐标为主，元素级 API 缺口大小取决于 M2 实测 → 决定
  Phase 2 自研 UIA 的投入。
- **cua-driver 分发**：用户机需装 driver（`irm https://cua.ai/driver/install.ps1 | iex`）。
  未装时 helper 明确 fail-closed 并给指引；是否随我们分发 driver（MIT 允许）另议。
- **koffi/打包**：打包期 staging 待接线；不阻塞 dev。
- **Mac**：暂缓。

## 6. M1 第一刀（下一步直接做）

1. `packages/zcode-cua`：placeholder `.js` → 真实现（保留 `.d.ts` 导出面；`package.json`
   加 `zcodeCuaRuntime` 契约 + helper entry/addon 路径）。
2. Helper 入口：`--socket/--parent-pid` 解析 → bind pipe → 控制消息 → RPC 服务端骨架
   （先反射 cua-driver 可用工具）。
3. `ZCODE_CUA_DEV_ROOT=packages/zcode-cua` 挂进 dev 实例，实测 `list_apps` 走通，
   记录在案（审计续节）。
