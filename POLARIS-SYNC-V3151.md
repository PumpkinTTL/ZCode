# Polaris × 上游 v3.15.1 合并接入（作战文档）

> 上游快照：`aac47556`（tag `v3.15.1`，自 v3.14.3 一个 squash）
> 回滚锚点：enterprise 的 tag `pre-v3151-merge`（含本文档提交）
> 沙盘工作区：`D:\DevelopmentProject\ZCode-sync-v3151`（分支 `sync/v3151-merge`，merge 已试跑、冲突未解，可随时继续或 `git merge --abort` 重放）
> 站令（2026-10-12）：业务功能一份不接；性能重件（如模拟器插件）待定；先打锚点再动工。

---

## 一、确认后的功能分档

### 1. 接 —— 核心能力（合并主体）

| 优先 | 核心能力 | 体量（非测试） | 冲突面 | 性能落点 |
|---|---|---|---|---|
| P0 | Dynamic Workflow 引擎（分析器+执行引擎+沙箱） | 7.5k 行 / 123 | 3 | Agent 进程按需 |
| P0 | UI Plugins + Gen UI + pluginSandbox | 14.8k 行 / 164 | 157 | 桌面渲染 + main（按需） |
| P0 | CLI/Agent 核心（工具/runtime/hooks/记忆） | 21.3k 行 / 580 | 123 | Agent 进程 |
| P0 | MCP 增强（Apps 2.0 / 第三方目录导入 / MCP OAuth） | 12.2k 行 / 97 | 71 | 桌面（+3 依赖） |
| P1 | UI 会话体验演进（v4 + 核心 + i18n 主体） | 54k 行 / 835 | 216 | 桌面渲染（主要变重点） |
| P1 | 内置**工具**插件：docx / pdf / xlsx / visualize / plugin-creator / superpowers | ~3 万行 + 2 万技能资产 | 20 | Agent 侧按需 |
| P1 | Web 远程控制（保留，feature gate 默认关） | 8.5k 行 / 33 | 0 | main + web |
| P2 | 内嵌浏览器权限体系 | 1.1k 行 / 11 | 2 | 桌面 main |
| P2 | Bots 群机器人（能力向，不绑官方后端；可后置） | 7.2k 行 / 35 | 9 | host 进程 |
| P3 | output-style（Agent 输出风格） | 341 行 / 4 | 0 | Agent 侧 |
| 🔧 | 工程基建（根 vitest / e2e / e2e-report / dev-docs） | 脚本级 | 6 | 不进运行时 |

### 2. 待定 —— 性能重件（本轮不落地，路径留存待议）

- `apps/zcode-cli/packages/android-emulator-plugin`（29 文件）
- `apps/zcode-cli/packages/ios-simulator-plugin`（23 文件）
- 决议方式：合并后从树上移除；将来需要时按插件粒度单独接入。

### 3. 剔 —— 业务功能（**一份不接**，见 §二 排除清单）

Rewards 邀请奖励中心、marketing-touch 营销触达、cloud-content 云内容、manualClaimPlan 体验套餐活动、
highspeed 加速卡、Stripe 支付、官方账号/套餐/官方网关、上游遥测链路、request-security-edition 专有错误码文案。

---

## 二、业务功能排除清单（合并后必须清扫至零残留）

### A. 整目录 / 整文件删除

| 路径 | 是什么 |
|---|---|
| `packages/ui/src/rewards/` | 奖励中心（邀请好友内嵌页） |
| `packages/ui/src/components/marketing-touch/` | 营销弹窗/横幅/上报（10 文件） |
| `packages/ui/src/components/cloud-content-dialog/` | 云内容领取弹窗（9 文件） |
| `packages/ui/src/components/manual-claim-plan/` | 限时体验套餐领取 |
| `packages/ui/src/highspeed/` | 加速卡（含分享裂变、到期时钟，17 文件） |
| `packages/ui/src/assets/cloud-content/` | 营销素材（weekend-plan-hero 等） |
| `packages/ui/src/request-security-edition/` | 上游网关专有错误码文案 |
| `packages/services/src/marketing-touch/`、`cloud-content/`、`highspeed/`、`request-security-edition/` | 对应服务层 |
| `packages/shared/src/` 的 `rewardsBridge.ts` `rewardsEmbedded.ts` `marketingTouch.ts` `cloudContent.ts` `highspeed.ts` | 契约/类型 |
| `packages/desktop/src/preload/rewardsWebview.ts` | 奖励网页 preload 桥 |
| `packages/desktop/src/scheduler/manualClaimRelease.ts` | 体验套餐定时投放 |
| `apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts` 等官方套餐链 | 按既有砍除合同 |

### B. 外科集成点（保留文件、剔除业务线）

- ui 侧栏/头像菜单的「**邀请好友 [奖励]**」入口（Gift 图标）与 `RewardsProvider` / `MarketingTouchProvider` 挂载点
- 会话渲染中的 highspeed footer/toast 分支（`highspeedOutputFooter` 标记位）
- `packages/shared/src/channels.ts` 中 Rewards/MarketingTouch/CloudContent/Highspeed 通道常量
- `share-ui` 的 `@stripe/*` 依赖（采纳包时剥离）
- i18n key 清理：`rewards.*` / `marketingTouch.*` / `cloudContent.*` / `manualClaimPlan.*` / `chat.highspeed.*` / `globalNotice.highspeed.*` / `codingPlan.billingDiscount*` + 「邀请你也来下载…zcode.z.ai」文案

### C. 天然对齐（上游改过、我们已删 —— 沙盘 DU 冲突 127 个）

决议规则：**一律保持删除**。已抽查确认其中为：coding-plan-subscription 实现、oauth zai/bigmodel 适配器、
StartPlan 三件（chat-input-toolbar / hooks / settings）、coding-plan-quota-reset、login 助手等——与
`POLARIS-CUT-TASKS.md` 合同一致；逐个过一遍确认无核心引用即可。

---

## 三、沙盘合并试跑结果（2026-10-12，`sync/v3151-merge`）

merge `aac47556` → enterprise：**357 个冲突文件**（vs 预估 939 交叉面 —— 大部分自动解决），其余
自动落地：**新增 A 9535 / 修改 M 1563**。

| 冲突类型 | 数量 | 说明 | 决议方向 |
|---|---|---|---|
| UU 内容冲突 | 177 | ui 55 / cli 31 / services 23 / desktop 22 / shared 17 / server-cli 7 / … | 逐类决议（品牌件按重命名规则重放为主） |
| DU 已删×上游改 | 127 | ui 75 / desktop 26 / services 17 / cli 7 | 保持删除（§二C） |
| AA 双方同路径新增 | 50 | visualize-plugin / gen-ui-fixture / mcp-apps-host-fixture / pluginSandbox 等（feat/ui-plugin 旧版 vs v3.15.1 版） | 取上游新版 + 品牌二次清洗 |
| UD 我们改×上游删 | 3 | `deviceMid.ts`（查上游迁移去向）+ 2 个 node:test | 逐个核实 |

- UU 中的明确业务件仅 3 个（coding-plan-subscription ×2 + shared 类型）→ 随 §二 清扫。
- **自研层抽查零冲突**：`business/quota`、`business/appUpdate`、`nimbus` 全部自动保留 ✅
- 锁/清单文件：`pnpm-lock.yaml`（取上游后重装）、`third-party/inventory.json`、`npm-overrides.json`（合并后重生成）。

---

## 四、执行计划（阶段化）

1. **锚点** ✅ 本文档提交 + tag `pre-v3151-merge`
2. **冲突决议**（沙盘分支内）：
   a. 先落地规则：§二A/B 业务件一律删除；§二C 保持删除；AA 取上游；UU 逐类（品牌按 G1-G4 重命名规则重放）
   b. 业务排除 sweep：脚本化校验（关键词/路径零残留）
3. **构建与品牌清洗**：`build:bootstrap` 通过 → G1-G4 grep 清单对 v3.15.1 新文件重跑 → build + dev 冒烟
4. **性能专项**（对账，交付报告）：
   - renderer 产物体积 / 启动耗时 对比表
   - 旧优化点核对：mermaid/katex 导入、manualChunks、force-update gate 阻塞、logger 写盘、settingService 读盘、fs.watch 递归
   - 新增热点排查：pluginSandbox、MCP 客户端、lottie-web、内嵌浏览器权限
5. **测试**：上游新 vitest 体系 + 我们既有套件全绿
6. **收尾**：dev 全链路验收（登录/会话/更新检查/额度面板）→ 合回 `enterprise` → tag `v3.15.1-polaris.1`

## 五、风险与回滚

- 一键回滚：`git reset --hard pre-v3151-merge`（enterprise）
- 沙盘独立工作区，不影响主树与运行中的 dev 应用；可 `git merge --abort` 整体重放
- 红线：任何冲突决议不得引入 §二 清单内的业务文件；Agent 核心能力（workflow/子代理）不得破坏
