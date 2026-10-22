# Polaris × 上游 v3.16.2 合并接入（作战文档）

> 上游快照：`3c5b2276`（"chore: sync ZCode source" ×2，根 package.json `3.16.2`；无 tag）
> 回滚锚点：分支 `sync/v3162-merge` 上的 tag `pre-v3162-merge`（= enterprise `eed28399` + 本文档）
> 站令（2026-10-16）：**最快速最优合并；核心功能全接；业务功能零接入（红线）；已砍除状态必须保持（红线）；子代理并行施工，主会话统一验证与提交。**

---

## 一、规模与冲突面（实测）

| 指标 | 数量 |
| --- | --- |
| 上游改动文件 | 4,579（+36.7 万 / −12.6 万行） |
| 双方都改（冲突候选） | 699 |
| 我们已删 × 上游又改（DU 候选） | 211 |
| 排除清单关键词命中（上游侧） | 42 |

---

## 二、核心功能分档（本轮全接）

- **Composer 模型+思考档位合并入口 + Think 拖拽滑杆**（`docs/composer-model-thinking.md`）：UI 骨架照收；`composerPlanGroups.ts` 的 team-plan/connection（`TeamProduct`、`formatTeamPlanDisplayName`、`ProviderFamilyConnectionSelection`）**剪除**，分组回退到自有 `modelSelectionGroups`；接入标签只留 API 一态。已知双改热点 7 文件：`ModelConfigSelect` / `ThoughtLevelCycleControl` / `contextUsage` / `thoughtLevelOptions` / `composerRecent` / `ConversationComposer` / `V4ComposerToolbar`（后三 + 前 2 均为我们大砍域）。
- **office-runtime 新包**（`apps/zcode-cli/packages/office-runtime`）：接（docx/pptx 工具链底座）。
- **zcode-cua 构建链**（`build:cua`、typecheck 收编）：接。
- **db:schema:check / SQLite schema 契约**、**architecture governance 扩展**（upstream-admission / source-size-policy / adopt）：接，按 Polaris 既有 architecture-policy 适配。
- **desktop tsconfig 拆分**（main / remote-main）、web-remote-control 构建迁移 server-cli：接。
- 上游 UI/引擎/MCP/工作流等演进主体：照单全收（同 v3.15.1 分档口径）。

## 三、业务排除红线（在 v3.15.1 清单之上继续执行）

既有清单（rewards / marketing-touch / cloud-content / manualClaimPlan / highspeed / Stripe / 官方账号·套餐·网关 / 上游遥测 / request-security-edition / official-coding-plan-gateway）**保持删除**；本轮新增上游改动中命中的 42 个文件一律不接。DU 冲突（我们删 × 上游改）**默认保持删除**；若上游核心代码因此引用缺失模块且属核心功能，**报告主会话决策，不得擅自恢复业务代码**。新出现的疑似业务（订阅/支付/营销/激励语义）一律标记上报，不得静默采纳。

## 四、品牌与契约规则（沿用，不重议）

- 用户可见 `ZCode`→`Polaris`、数据目录 `.polaris`、域名 `nimbus.bitlesu.com`、appId `com.bitlesu.polaris`、`.polarisignore`（带旧名兼容）、`.polaris-share`。
- **不改** `@zcode/*` 包名、`ZCODE_*` 环境变量、`zcode://` 协议、`.zcode-plugin/`、上游协议串（如 "ZCode Protocol/1"、`zcodePluginMarketplaceSummarySchema`）。
- 官方端点一律改指自有（`resolveZaiBusinessBaseUrl` / `resolveBigModelApiOrigin` / nimbus），或默认关闭。

## 五、执行计划

1. **锚点** ✅ 本文档提交 + tag `pre-v3162-merge`
2. **合并**：`sync/v3162-merge` 上 `git merge upstream/main`；冲突按域分区，子代理并行决议
3. **机械层（主会话）**：业务 DU `git rm`；`pnpm-lock.yaml` 取上游后重装重生成
4. **分区施工（子代理）**：ui-composer / ui 其余 / desktop / cli / services+shared / web+server+杂项 —— 各自只动分内文件，`git add` 自己的路径；**禁跑构建/全量测试**（主会话统一做）
5. **统一验证（主会话）**：`pnpm install` → `typecheck` → 业务关键词/路径零残留扫 → 品牌 grep → `build:bootstrap` → `test:unit` 全量
6. **收尾**：合并提交 → 回 `enterprise` → push → tag `v3.16.2-polaris.1`

## 六、回滚

`git reset --hard pre-v3162-merge`（sync 分支）；enterprise 全程不动，天然可弃分支。
