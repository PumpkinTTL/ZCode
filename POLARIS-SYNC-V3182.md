# Polaris × 上游 v3.18.2 合并接入（作战文档）

> 上游快照：`fec97590`（v3.17.1 → v3.17.2 → v3.18.0 → v3.18.1 → v3.18.2，5 个提交）
> 基线：`v3.16.2-polaris.1`（`1ea32985`）；回滚锚点：tag `pre-v3182-merge`
> 站令（2026-11-14）：不停滞，继续跟随上游至 v3.18.2；红线不变——核心全接、业务零接入、已砍保持砍除。
> 上轮资产：分区方案/扫描脚本/架构准入机制/测试收口先例（含 Node 25 localStorage shim）全部沿用。

---

## 一、侦察数据（实测）

| 指标 | v3.18.2 合并 | 对照 v3.16.2 |
| --- | --- | --- |
| 上游改动文件 | 8,599（+66.3 万 / −66.0 万） | 4,579 |
| 双方都改（冲突候选） | 1,158 | 699 |
| 我们已删 × 上游又改（DU 候选） | 475 | 211 |
| 红线关键词命中（上游侧） | 163 | 42 |

版本结构：v3.17.1 = 上游自身大清理（−61 万行，含其自砍 highspeed 测试）；v3.17.2 小补丁；
v3.18.0 = 大功能潮（**新包** design-runtime / design-plugin / plugin-api / session-control，CLI +567 文件）；
v3.18.1/.2 补丁。

## 二、红线（沿用 v3.16.2 口径，不重议）

1. **业务零接入**：rewards / marketing-touch / cloud-content / manualClaimPlan / highspeed / 加速卡 / Stripe /
   payment / coding-plan-subscription / official-coding-plan-gateway / StartPlan(体验套餐) /
   request-security-edition / 官方 OAuth(zai、bigmodel 登录) / 官方套餐额度展示。
2. **已砍保持砍除**：DU 冲突默认 `git rm`；上游核心引用已删模块时报告主会话，不擅自恢复。
3. **品牌**：用户可见 ZCode→Polaris；数据目录 `.polaris`；官方域名只准作匹配键或经
   resolve* helper 指自有（nimbus）；`@zcode/*` 包名 / `ZCODE_*` 环境变量 / `zcode://` 协议串不改。
4. **内建 provider 模板**：zcode-builtin*.json 只允许 nimbus + 三方厂商；模型元数据规则照收。
5. **遥测**：schema/类型模块可随上游准入（架构例外，注明边界）；上报实现/ARMS/端点一律不接。
6. 死依赖核查：上游新增 package.json 依赖逐个验引用，零引用者剔除（先例：lottie-web/@xyflow）。

## 三、已知环境坑（上轮实证，直接规避）

- 根 package.json 的 patchedDependencies 可能带回已删 patch（先例 @arms）→ install 前核对。
- pre-push：分支先单独推（校验链全跑）；tag 用 `--no-verify` 后推（HEAD 耦合校验只适用分支）；
  发布 tag 推完如有收尾修复需 `tag -f` 挪到最终提交。
- 架构门禁 `unmanaged-new-file`：上游新增 schema/类型模块需逐个加 exceptions（注明纯类型边界）。
- Node 25 localStorage shim 已在 vitest.setup.ts；it.each 不传 context 形参（上游测试文件含此坑，
  用例内早退跳过）；Windows EPERM rename 为瞬时抖动，单独重跑复验。

## 四、执行计划

1. **锚点** ✅ 本文档 + tag
2. **合并**：merge upstream/main → 冲突分类清单
3. **机械层**：业务/文档 DU 保持删除、UD 接受上游、锁文件/库存取上游
4. **分区代理（并发 ≤4）**：ui-composer / ui-v4 / ui-根设置 / desktop / cli / services+shared / 基建
   （沿用上轮清单脚本；每 3-5 文件 `git add`，限额/中断后从实时状态重派）
5. **统一验证**：install（核对 patch 清单）→ typecheck 清零 → 业务/品牌三道扫 + 出网域名总表 →
   architecture:check 0 违规（新 schema 模块逐个准入）→ build:bootstrap → test:unit 全量
6. **收官**：合并提交 → ff 回 enterprise → push 分支（校验链全跑）→ tag `v3.18.2-polaris.1` 后推

## 五、回滚

`git reset --hard pre-v3182-merge`（sync 分支）；enterprise 全程不动直至验证全绿。
