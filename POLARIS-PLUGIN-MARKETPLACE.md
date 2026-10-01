# Polaris 插件市场：多源 + 三级降级 + 外部工具接入

> 本文是插件市场能力的设计、运维与接入说明。改动涉及市场源解析、目录刷新降级、
> 设置页 UI 与外部工具接入点。相关代码集中在：
>
> - `packages/shared/src/plugin-marketplaces.ts`（源注册表 / 预置清单 / 接入点）
> - `apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts`（源解析、拉取、激活）
> - `apps/zcode-cli/packages/bootstrap/src/plugins.ts`（overview / 刷新 / 降级判定）
> - `packages/ui/src/settings/{PluginStorePage,AddMarketplaceSourceDialog,PluginStoreSourcesDialog}.tsx`

---

## 1. 目标与定位

- **保留整个市场框架**：源解析、多源并存、安装/启用/更新/卸载、目录快照、依赖闭包全部保留。
- **源可选、源可添加**：默认源可由 Polaris 自主掌控；公开目录作为「预置源」供用户一键添加。
- **三级降级**：远程拉取失败时不再裸报 `fetch error`，而是回退到上次成功快照，再回退到内置目录。
- **外部工具可接入**：为后续要接入的工具提供稳定、无代码侵入的接入点。
- **去品牌**：默认不向任何官方（Z.ai / BigModel）服务发请求；默认源与预置源都由 Polaris 自己指定。

---

## 2. 概念模型

| 概念         | 说明                                                                                                                                                                  | 是否联网         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **内置插件** | 随应用打包的 10 个插件（browser-use / image-search / documents / pdf / presentations / spreadsheets / node-repl-host / skill-creator / plugin-creator / zcode-guide） | 否，本地 seed    |
| **默认源**   | 应用自带并自动登记的市场源（`zcode-plugins-official`），按**镜像列表**优先级刷新                                                                                      | 仅刷新时         |
| **镜像源**   | 同一个 `zcode-plugins-official` 目录的多个来源（Polaris 自有 + Z.ai 原站），按优先级逐个尝试                                                                          | 仅刷新时         |
| **预置源**   | 公开、可直接添加的 `.claude-plugin/marketplace.json` 目录清单，**不自动添加**                                                                                         | 用户点「添加」后 |
| **用户源**   | 用户手动输入的任意源（GitHub / git / URL / npm / file / directory / zip）                                                                                             | 用户触发时       |

**关键设计**：默认源自动登记；预置源只是「建议清单」，必须用户显式添加。因此**默认安装不向任何第三方发请求**。

### 2.1 格式是公开标准，不是私有

市场清单使用 Claude Code 的开放格式 `.claude-plugin/marketplace.json`（`name` / `owner` / `plugins[]`）。
插件包本身识别三种 manifest（与 Claude / Codex / Cursor 生态一致）：

```
.zcode-plugin/plugin.json     ← Polaris 自有
.claude-plugin/plugin.json    ← Claude
.codex-plugin/plugin.json     ← Codex
```

因此市场**内容源不是任何厂商独有的**：公开 GitHub 上有大量同格式目录，直接可对接。

---

## 3. 源类型（`MarketplaceSource`）

`apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts` 支持以下源，全部保留：

| 类型                 | 形态                                                    | 备注                         |
| -------------------- | ------------------------------------------------------- | ---------------------------- |
| `url`                | `{ source: "url", url }`                                | 直连 `marketplace.json`      |
| `github`             | `{ source: "github", repo, ref?, path?, sparsePaths? }` | `owner/repo` 简写即此        |
| `git`                | `{ source: "git", url, ref?, path? }`                   | 任意 git 远端                |
| `git-subdir`         | 目录内子路径                                            | Claude 标准里的 `git-subdir` |
| `npm`                | `{ source: "npm", package }`                            | npm 包                       |
| `file` / `directory` | 本地 `.json` 或目录                                     | 离线可用                     |
| `zip`                | zip 归档（带 sha256）                                   | 插件包形态                   |

`parseMarketplaceSourceInput()` 负责把用户输入串归一化成上述结构；`addMarketplace()` 负责拉取、
校验、原子激活与回滚。

---

## 4. 三级降级状态机

```
remote     刷新成功                       → 正常，无标记
snapshot   刷新失败 + 本地有上次成功目录  → degraded（warning），商店照常展示旧快照
bundled    官方源 + 内置 seed             → 内置插件始终在本地，离线可用
none       刷新失败 + 本地无任何目录      → error（真的什么都没有）
```

### 4.1 判定位置

`apps/zcode-cli/packages/bootstrap/src/plugins.ts` → `updateZCodePluginMarketplace()`：

```ts
const hasLocalCatalog = loadMarketplaceManifestSync(pluginStorageRoot, record.id) !== null;
severity: hasLocalCatalog ? "warning" : "error";
```

有本地目录时消息会追加
`...; keeping the last successful catalog.`，并保留原始失败原因。

### 4.2 为什么这样判定

- 目录快照是**原子激活**的（`atomic-directory.ts`），刷新失败不会破坏上一份成功目录。
- 所以只要 `marketplace.json` 存在，商店就仍然可用 → 这只是**降级**，不是故障。
- 只有「失败 + 无目录」才是真的空，必须报错让用户看到。
- 影响：`zcode plugins update <plugin>` 内部先刷新目录、若出现 error 就中止更新（见
  `updateZCodeMarketplacePlugin`）。降级为 warning 后，**一次网络抖动不再阻断插件更新**。

### 4.3 官方目录镜像（同一 id 的多个来源）

`zcode-plugins-official` 的 manifest 声明名与官方保留 id 同名，因此**不能**作为普通用户源添加
（会被保留 id 守卫拒绝）。它的多个来源以**镜像**形式存在：

`packages/shared/src/plugin-marketplaces.ts`：

```
OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS = [
  https://polaris.bitlesu.com/plugins/marketplace.json          // 优先级 1（Polaris 自有）
  https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json // 优先级 2（Z.ai 原站，兼容镜像）
]
```

- 刷新官方目录时按顺序逐个尝试：**前一个不可达就降级到下一个**，全部失败才记账。
- 实测：主源（未部署）DNS 失败约 1.1s 后回退到 Z.ai 原站，成功拉到 26 个插件，无 error。
- 成功后 `known_marketplaces.json` 的 `source` 会指向本次成功的镜像；下一次刷新仍按镜像列表顺序重试。
- 命中的镜像目录会写入官方目录的 CDN 分片（`cdn-marketplace.json`），与内置 seed 合并。

### 4.4 体积与物化策略（添加快、不拉整仓）

添加一个市场源**不等于**把它的插件全部下载到本地。策略分三层：

| 阶段            | 行为                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **添加 / 刷新** | `github` 源直接按 ref 取清单（`raw.githubusercontent.com/<repo>/<ref>/.claude-plugin/marketplace.json`），**不 clone 仓库**；取不到才回落到 clone（clone 出来的临时树读取完即清理，不落盘） |
| **落盘**        | **永远只写 `marketplace.json`**（+ 官方目录的 `cdn-/bundled-` 分片）。`loadMarketplaceFromSource` 只读清单，没有任何复制源树的路径                                                          |
| **安装**        | 相对路径条目按住物化：对需要它的仓库做一次 **sparse checkout**，只取那几个目录（`git-subdir` / `--sparse`）；自带的 `url` / `github` / `git-subdir` / `npm` / `zip` 条目直接解析，不取仓    |

实测（最终代码，临时 storage root，真实网络）：

```
ADD  anthropics/claude-plugins-official (314)   472ms   磁盘 184K
ADD  alirezarezvani/claude-skills (99)          253ms   磁盘  92K
ADD  xiaolai/claude-plugin-marketplace (19)     265ms   磁盘  19K
INSTALL 相对路径条目 marketing-skills           4053ms  ← sparse checkout 只取那一个目录
```

对照旧行为：同一个 314 条目目录要**整仓 clone 再整树复制**（实测旧数据在盘上 15M，另一个 99 条目的仓库 60M），耗时取决于仓库体积，与插件数无关。

**源树所有权**：物化得到的临时仓库由调用方负责清理（install / describe 结束即删），市场目录里**不存在长期驻留的源树**，只有 `marketplace.json`。

**历史包袱自动回收**：旧版本的整树由 `activateDirectoryAtomically`（无 `sourcePath` = 整目录重建）在下次刷新该源时**原子替换掉**，不需要用户「移除再加」。实测：`claude-code-skills` 从 60M 收敛到 96K。

### 4.5 UI 呈现

- `ZCodePluginMarketplaceSummary` 新增可选字段 `degraded?: boolean`（protocol schema
  `zcodePluginMarketplaceSummarySchema` 同步增加，`.strict()` 已更新）。
- 「市场源」对话框（`PluginStoreSourcesDialog`）：
  - `degraded` → 中性提示：`离线目录：刷新失败于 {time}，正在使用上次成功的目录`
  - 非降级失败 → 原报错样式（`刷新失败于 {time}: <message>`）
- 商店列表本身无需改动：展示的是快照内容，天然可用。

#### 4.5.1 对话框溢出（组件层已修，别再靠调用方自觉）

「添加市场源」对话框曾出现**内容整体溢出面板**：推荐源列表的 `truncate`（`white-space: nowrap`）把
`DialogContent` 的 `auto` 列轨道顶宽，于是**同层所有直接子元素**（标题、输入框、页脚按钮）都跟着画到面板右侧外面。

复现与验证（隔离 harness，同一份内层标记，只改外壳两条 class）：

```
修复前（grid，auto 轨道）          面板右边界 477
  输入框右边界 574 ✗   页脚右边界 574 ✗   溢出的直接子元素 4 个（title/section/field/footer）
修复后（grid-cols-[minmax(0,1fr)] + [&>*]:min-w-0）
  输入框右边界 978 ✓   页脚右边界 978 ✓   溢出的直接子元素 0 个
```

修在**组件层**（`components/ui/dialog.tsx`）：列宽钉成 `minmax(0, 1fr)`、直接子元素默认 `min-w-0`。
调用方用 `cn()`（`tailwind-merge`）传自己的 `grid-cols-*` 仍可覆盖，所以不影响既有弹窗。
调用点上的 `min-w-0` / `overflow-x-hidden` / `shrink-0` 保留为第二道保险。

---

## 5. 预置源清单（全部实测可添加）

来源：`packages/shared/src/plugin-marketplaces.ts` → `PRESET_PLUGIN_MARKETPLACES`。

| 展示名                  | 源                                           | 目录声明名（添加后的 id） | 条目数 |
| ----------------------- | -------------------------------------------- | ------------------------- | ------ |
| Claude Plugins Official | `anthropics/claude-plugins-official`         | `claude-plugins-official` | 314    |
| Awesome Claude Plugins  | `composio-community/awesome-claude-plugins`  | `awesome-claude-plugins`  | 24     |
| Claude Code Skills      | `alirezarezvani/claude-skills`               | `claude-code-skills`      | 99     |
| Sylvain's Plugins       | `sgaunet/claude-plugins`                     | `sylvain-marketplace`     | 4      |
| xiaolai Marketplace     | `xiaolai/claude-plugin-marketplace`          | `xiaolai`                 | 19     |
| Agent 37 Skills         | `agent37-platform/agent37-skills-collection` | `agent37-skills`          | 3      |

**未收录**：`dvcrn/openclaw-skills-marketplace`（26k+ 条目，仓库归档超过 GitHub archive 源的
200MB 上限，添加必然失败）。需要时用户可手动添加。

### 5.1 增删预置源的要求

1. 该仓库根目录必须**确实存在** `.claude-plugin/marketplace.json`（用
   `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/.claude-plugin/marketplace.json` 核对）。
2. 记录其顶层声明的 `name` 到 `catalogName`——添加后会成为 marketplace id，用于「已添加」判断。
3. 本地实跑一次 `addZCodePluginMarketplace`（见 §8 可用性测试）确认能成功添加。
4. 注明归属/授权（`license` / `homepage`）。预置源里的第三方插件**各有自己的 LICENSE**，
   收录/再分发需逐个核对。

---

## 6. 外部工具接入（Integration Hook）

后续要接入的工具可用以下任一方式，**无需改动市场框架**。

### 6.1 环境变量注入（推荐，零代码）

```bash
POLARIS_PLUGIN_MARKETPLACE_SOURCES=my-org/my-hub,https://git.example.com/team/plugins.git
```

#### 6.1.1 官方目录镜像优先级（手动可调）

```bash
# 只保留 Z.ai 原站
POLARIS_PLUGIN_MARKETPLACE_MIRRORS=https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json

# 把自己的镜像提到最前，Z.ai 作兜底
POLARIS_PLUGIN_MARKETPLACE_MIRRORS=https://mirror.example.com/marketplace.json,https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json
```

- 逗号或换行分隔，**靠前的优先**；非空时完全覆盖内置默认顺序（顺序即优先级）。
- 与 `POLARIS_PLUGIN_MARKETPLACE_SOURCES` 的区别：前者是「预置可添加的独立源」，
  本项是「官方目录的来源顺序」。

- 逗号或换行分隔；每项是 `parseMarketplaceSourceInput` 能接受的源串（`owner/repo`、git URL、本地路径…）。
- 注入源会出现在「添加市场源」的预置列表里，仍由**用户显式添加**后才联网——它是稳定接入点，
  不是静默联网开关。
- 与内置预置同源时不会重复（按源串去重，保留内置展示信息）。
- 解析实现：`parsePluginMarketplaceSourceList()` + `resolvePresetPluginMarketplaces()`
  （浏览器安全：`process` 不存在时只返回内置清单）。

### 6.2 代码注册（随版本发布）

在 `PRESET_PLUGIN_MARKETPLACES` 里加一项即可（字段见 §5.1）。这是**唯一的清单真相源**，
UI / CLI / 文档都从这里读。

### 6.3 工具自带一个 hub

若工具要分发自己的插件，最简做法是让它提供一个仓库，根目录放：

```
.claude-plugin/marketplace.json
```

```json
{
  "name": "my-tool-hub",
  "owner": { "name": "My Tool" },
  "plugins": [
    {
      "name": "my-plugin",
      "description": "…",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/my-org/my-tool.git",
        "path": "packages/my-plugin",
        "ref": "main"
      }
    }
  ]
}
```

然后按 §6.1 或 §6.2 把它注册为预置源。`name` 会成为 marketplace id，请保持稳定（改名会断已安装记录）。

### 6.4 契约摘要（工具方需要知道的）

- 顶层：`name`（必填，`^[a-z0-9][a-z0-9._-]{0,127}$`）、`description?`、`owner?`、`plugins[]`、
  可选 `featured[]`（公开分段精选）、`allowCrossMarketplaceDependenciesOn[]`。
- 条目：`name`、`description?`、`version?`、`source`（见 §3）、`dependencies?`、`strict?`、
  `tags?`、`listing?`（展示元数据：`displayName` / `icon` / `category` / 作者 / hero / 示例提示词…）。
- 条目 `source` 也可为**相对路径**（指向同仓库内的插件目录）。

---

## 7. 安全、合规与去品牌

- **默认优先自有源**：官方目录镜像列表以 Polaris 自有地址为先，Z.ai 原站仅作兼容镜像。
  预置源一律不自动添加。注意：Z.ai 镜像不在首位仍会在主源不可达时被访问（这正是「加降级」的结果）；
  若不愿访问它，把 `POLARIS_PLUGIN_MARKETPLACE_MIRRORS` 设为自有地址即可。
- **信任边界**：市场条目是**内容包**——市场只读 manifest 与插件目录，不 in-process 加载任意运行时代码；
  插件声明的能力（skill / command / agent / hook / mcp）走各自既有的校验与门禁。
- **许可**：市场框架代码属本仓库（Apache-2.0）。目录里的**第三方插件各自授权**，与其托管来源的服务
  条款无关；重新分发前逐个核对 LICENSE。**Apache-2.0 不授予商标权**，因此第三方品牌不得作为 Polaris 标识。
- **命名**：`zcode-plugins-official` 等 id 是协议/存储契约，保持不变；用户可见文案一律 Polaris 化。

---

## 8. 可用性测试

### 8.1 单元/集成测试（仓库内，离线、无网络）

```bash
node_modules/.bin/tsx --test packages/shared/test/pluginMarketplaces.test.ts
node_modules/.bin/tsx --test apps/zcode-cli/packages/bootstrap/test/marketplaceDegradation.test.ts
```

覆盖（8 + 3 个测试）：

- 预置源唯一性 / 必填字段 / `catalogName` 存在性
- 源串列表解析（切分、去空、去重）
- 环境变量注入与去重；无 env 时的浏览器安全性
- 「已添加」判定（按 catalogName 与归一化源串）
- 官方目录镜像默认顺序（Polaris 先、Z.ai 后）与 env 覆盖（优先级可手动调）
- **降级**：有本地目录 → warning + `keeping the last successful catalog`；无目录 → error
- **镜像降级**：镜像不可达时按优先级回退到 `record.source`，不报 error

### 8.2 真实源可用性（一次性、需要网络）

```bash
# 在临时 storage root 里逐个添加预置源，确认 id 与 catalogName 一致
```

实测结果（2026-09）：

- 上表 6 个预置源全部添加成功，`id` 与 `catalogName` 完全一致。
- 官方目录镜像：主源不可达（约 1.1s）后回退到 Z.ai 原站，拉到 26 个插件，`refreshFailure` 为空。

### 8.3 手工验证（应用内）

1. 打开 设置 → 插件 → 商店 顶栏「+ / New」→ 添加市场源。
2. 「推荐市场源」里点任一「添加」→ 自动切到「个人」分段并可见新来源。
3. 再次打开对话框：已添加项不再出现在推荐区（`isPresetMarketplaceAdded`）。
4. 对一个源点刷新，同时断网 → 该源显示「离线目录」，商店列表仍可用（不是 fetch error）。

---

## 9. 排查

| 现象                                      | 可能原因                     | 处理                                                          |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| 市场列表为空                              | 唯一的源刷新失败且本地无快照 | 检查默认源地址是否可达；内置插件不受影响                      |
| 源显示「离线目录」                        | 远程不可达但快照可用         | 正常降级；恢复网络后点刷新                                    |
| 添加某源失败 `HTTP response is too large` | 仓库归档 > 200MB             | 该源不适用 archive 路径；改用 git/github 且限制 `sparsePaths` |
| 添加后 id 与预期不符                      | 目录声明名与预期不同         | 以 manifest 的 `name` 为准，修正 `catalogName`                |
| 出现重复来源                              | 目录改名导致 id 变化         | 删除旧来源后重新添加                                          |

---

## 10. 变更记录

| 文件                                                                   | 变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/plugin-marketplaces.ts`                           | 新增 `PresetPluginMarketplace`、`PRESET_PLUGIN_MARKETPLACES`、`PLUGIN_MARKETPLACE_SOURCES_ENV`、`parsePluginMarketplaceSourceList`、`resolvePresetPluginMarketplaces`、`isPresetMarketplaceAdded`、`normalizeMarketplaceSourceForCompare`；新增官方目录镜像 `POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL` / `ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL` / `OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS` / `PLUGIN_MARKETPLACE_MIRRORS_ENV` / `resolveOfficialPluginMarketplaceMirrors` |
| `apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts`          | 新增 `resolveMarketplaceRefreshSources`：官方目录按镜像优先级逐个尝试；`updateMarketplace` / `ensureMarketplaceManifestAvailable` 支持降级回退；新增 `readRelativeSourcePath` / `marketplaceRequiresLocalSourceTree` / `stagedMarketplaceHasSourceTree` / `tryLoadGitHubMarketplaceManifest` / `resolveMarketplaceSourceTree`：github 源免 clone 取清单、按需才落源树、安装时 sparse 物化                                                                                   |
| `apps/zcode-cli/packages/adapters/src/plugins/official-marketplace.ts` | 合并官方目录时只取镜像的**内容**字段（`featured` / `allowCrossMarketplaceDependenciesOn`），丢弃其品牌身份（`owner` / `description`）                                                                                                                                                                                                                                                                                                                                       |
| `apps/zcode-cli/packages/bootstrap/src/app/bundled-plugins.ts`         | 内置分片写入 Polaris 自有 `description`，压过镜像文案                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/shared/src/zcode-protocol/index.ts`                          | `zcodePluginMarketplaceSummarySchema` 增加可选 `degraded`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/zcode-cli/packages/bootstrap/src/plugins.ts`                     | `ZCodeMarketplaceSummaryData` 增加 `degraded`；overview 计算 `degraded`；刷新失败按「有/无本地目录」降级为 warning/error                                                                                                                                                                                                                                                                                                                                                    |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/plugins.ts`      | `toMarketplaceSummary` 透传 `degraded`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/ui/src/settings/AddMarketplaceSourceDialog.tsx`              | 新增「推荐市场源」一键添加区                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/ui/src/settings/PluginStoreSourcesDialog.tsx`                | 降级状态用中性提示替代报错样式                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/ui/src/settings/PluginStorePage.tsx`                         | 把预置源与已登记市场传给添加对话框                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`                        | `presets.*` 与 `store.sources.degraded` 文案                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/ui/src/components/ui/dialog.tsx`                             | 弹窗外壳列宽钉成 `minmax(0, 1fr)` + `[&>*]:min-w-0`：从组件层消除「一个 nowrap 子元素顶宽整条轨道，连累所有同级元素溢出」这一类问题（§4.5.1）                                                                                                                                                                                                                                                                                                                               |
| 测试                                                                   | `packages/shared/test/pluginMarketplaces.test.ts`（7）、`apps/zcode-cli/packages/bootstrap/test/marketplaceDegradation.test.ts`（6）、`apps/zcode-cli/packages/adapters/test/marketplaceStagingWeight.test.ts`（3）、`apps/zcode-cli/packages/adapters/test/officialMarketplaceBranding.test.ts`（品牌红线）                                                                                                                                                                |

验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors；CLI `turbo run typecheck` ✅ 27/27；
上述测试 ✅ 16/16。

### 10.1 变更记录（第二批：物化策略与 UI 修形）

| 文件                                                                     | 变更                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts`            | `loadMarketplaceFromSource` 改为**只读清单**（去掉 `persist` 与整树复制路径，签名去掉 `storageRoot`）；`tryLoadGitHubMarketplaceManifest`（github 免 clone 取清单）；`resolveMarketplaceSourceTree` 支持 `sparsePaths`；`installMarketplacePlugin` 安装相对路径条目时按需 sparse checkout；`addMarketplace` 统一走 `stageMarketplaceManifest`（只落 `marketplace.json`，旧整树被原子替换回收） |
| `apps/zcode-cli/packages/adapters/test/marketplaceStagingWeight.test.ts` | 守护测试：添加只落清单、安装按需物化、旧整树在刷新时被回收                                                                                                                                                                                                                                                                                                                                     |
| `packages/ui/src/components/ui/dialog.tsx`                               | 组件层修形（§4.5.1）                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/ui/src/settings/AddMarketplaceSourceDialog.tsx`                | 推荐源区块加 `min-w-0` / `overflow-x-hidden` / `shrink-0` 第二道保险                                                                                                                                                                                                                                                                                                                           |
