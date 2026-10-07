---
name: design-md
description: 项目视觉规范（DESIGN.md）的使用与维护指导——写任何 UI 前读本技能；改了视觉语言就同步 DESIGN.md
---

# Design-md · Polaris 视觉规范技能

## 何时用
- 写/改任何用户可见的 UI（面板、卡片、弹窗、菜单、表格）之前：先读仓库根 `DESIGN.md`，按规范写。
- 改了全局视觉语言（色板/字阶/间距/组件形态）：**必须**同步更新根 `DESIGN.md`，规范不许漂移。

## 规范来源
- 根目录 `DESIGN.md` = Polaris 自己的视觉语言（唯一事实源）。
- `references/` = 上游灵感参考（VoltAgent/awesome-design-md 合集：Linear、Vercel 等），
  只用来借鉴原则（层级靠颜色不靠字重、hairline 分隔、单一强调色纪律），**不照抄颜色**——
  Polaris 是浅色桌面应用，参考件多为深色营销页。

## 写 UI 的硬规则（从 DESIGN.md 提炼速查）
1. 字号只有两档：`text-xs`（12px，次级信息/标签/时间）与 `text-ui-*`（正文/标题）；
   层级靠**颜色**（foreground > foreground-subtle > foreground-subtlest）与**字重**（medium 仅用于
   主数值），禁止同级内用大小和粗细互相打架。
2. 数字一律 `tabular-nums` + **裸格式**（无千分位可选时遵用户偏好；无单位后缀——单位语义放标签里）。
3. 颜色纪律：蓝色 = 进度/主强调；emerald = 重置/成功类；destructive 红 = 删除类；
   其余一律灰阶。强调色不做装饰。
4. 分隔用 hairline（`border-border/60`）；卡片 `rounded-xl border bg-card`；
   行内条目 `rounded-lg bg-surface` + `px-4 py-3`（文字不贴边）。
5. 间距 4px 网格；同组元素 `space-y-2`，组间 `space-y-3`/`space-y-4`。
6. 时间显示绝对时刻（`10/8 02:48`）；禁止把「剩余时长」渲染成「钟点时间」形态。

## 维护
改了 DESIGN.md 后，在本文件「变更记录」追加一行日期 + 摘要。

## 变更记录
- 2026-10-07 初版：从 quota 业务卡的实际形态蒸馏（Linear 结构 + Polaris 现行 token）。
