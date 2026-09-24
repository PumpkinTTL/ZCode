# Polaris 残留巡检报告（2026-09-23）

> 只读审计 + 已确认的修复。凡是**会破坏既有磁盘/协议契约**的地方都只记录、不改，等你拍板。

## 结论速览

| 分类 | 数量 | 处置 |
|---|---|---|
| 官方域名运行时请求 | 4 处真请求 + 6 处潜伏/仅匹配键 | 见 §1（**未修**） |
| **`~/.zcode` 数据根泄漏（真 bug）** | 约 60 处本地数据根 | **已修复**（见 §2） |
| 用户可见 ZCode / Z.ai 品牌残留 | 约 40 处 | **应用名 / 窗口标题 / 分享页 / 托盘 / 关于框已修**，其余见 §3 |
| 契约型路径（不能改） | `zcode://`、`.zcode-plugin/`、`.zcodeignore`、远程 `~/.zcode/server` 等 | 见 §4（**保留**） |

---

## 1. 官方域名请求

### 1a. 真实出网（需要处理）

| 位置 | 内容 | 建议 |
|---|---|---|
| `apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts:4` | `ZAI_API_HOST = "https://api.z.ai"` 硬编码，**没走** `resolveZaiBusinessBaseUrl()`；`:122` 会真发 `POST /api/auth/z/login`，`:97` 发 `/api/biz/...`。同文件 `:81` 的 bigmodel 分支已经用了 `resolveBigModelApiOrigin` | 改指 `resolveZaiBusinessBaseUrl(process.env)` |
| `apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts:58` | `OFFICIAL_PLUGIN_ASSETS_BASE_URL = "https://cdn-zcode.z.ai/zcode/official-plugin/assets"`，给 8 个内置插件当地 `icon` URL 用（`:114` `:138` `:171` `:211` `:231` `:283` `:304` `:349`） | 本地化素材，或改指 `polaris.bitlesu.com/cdn` |
| `config/default.json:2` | `feedback_url` = 智谱飞书表单 | 改指自有（或确认就是要发官方） |
| `config/default.json:5,6` | `community_urls` = 飞书邀请 + `discord.gg/z9aBcQXZQ3` | 改指自有社群（UI 入口已隐藏） |
| `packages/services/src/model-provider/legacyZCodeConfigProviderReader.ts:64` | `BIGMODEL_CODING_PLAN_ANTHROPIC_BASE_URL = "https://open.bigmodel.cn/api/anthropic"`，作为**生产**兜底 baseUrl（`:71-73` `:79` `:88-90`）；导入旧 ZCode `config.json` 时会把请求打到 `open.bigmodel.cn` | 改指 `resolveBigModelApiOrigin()` |
| `packages/desktop/src/main/desktopMainIpcRemote.ts:79`、`desktopWindowChrome.ts:293` | 内嵌 webview 导航白名单里硬编码 `"https://api.z.ai"` | 删掉这条（默认已指向 polaris） |
| `apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts:4` | `DEFAULT_ZCODE_OAUTH_BASE_URL = "https://zcode.z.ai/api/v1"`（当前被调用方注入的 baseUrl 覆盖，属潜伏） | 默认值改指 polaris |

### 1b. 只是匹配键，不出网（保留）

- `apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts:24,28` —— 官方 baseUrl 仅作为**路由匹配键**，出网地址在 `:59-63` 被改写为 `resolveRuntimeZCodeEndpointOrigin`（polaris）。**保留**，否则识别不出官方渠道。
- `packages/shared/src/zcodeEndpoint.ts:12` `DEFAULT_ZAI_OAUTH_CLIENT_ID` —— 公共 client id，非密钥。按需替换为自有。
- `packages/ui/src/hooks/workspacePrepareRpc.ts:59` `"ZCode Protocol/1"` —— 协议版本串，**保留**。

### 1c. 已确认干净

`remoteCdn.ts`、`plugin-marketplaces.ts`、`autoUpdater` / `manifestUpdateProvider` / `forceUpdateGuard`、`env.ts` 的 ARMS/telemetry 端点（默认空 = 关闭）均已是 Polaris 或默认关闭。

---

## 2. `~/.zcode` 数据根泄漏（**已修复**）

> 实际修复范围比本节初稿更大：连同 CLI 的日志/rollout/db/config 读写侧一起搬到 `.polaris`，
> 否则「读的地方改了、写的地方没改」会变成更隐蔽的 bug。用户级路径统一 `.polaris`，
> workspace 级 `.zcode` 点文件契约原样保留。

### 2a. 已实测确认的危害

```
~/.zcode/v2/setting.json         ← 今天仍在被 Polaris 改写（含 recentProjects）
~/.polaris/v2/setting.json       ← 根本不存在
```

也就是说：**设置文件一直写在官方 ZCode 的数据目录里**，与用户真实安装的 ZCode 数据互相污染。
（本机 `~/.zcode` 还是个指向 `/e/AppData/UserRoot/.zcode` 的符号链接。）

根因：`packages/services/src/paths.ts:43` 的 `DATA_ROOT_DIR_NAME = ".polaris"` 只覆盖了走
`getZCodeDataRootDir()` / `getAppConfigDir()` 的调用方，另有约 20 处直接字面量写 `".zcode"`。

### 2b. 修复清单

| 位置 | 原 | 改为 |
|---|---|---|
| `services/src/setting/settingService.ts` | `<home>/.zcode/v2` | `DATA_ROOT_DIR_NAME` |
| `desktop/src/main/index.ts:532` | `homedir()/.zcode/v2/setting.json` | 同上常量 |
| `desktop/src/main/desktopChromiumHardwareAccelerationBootstrap.ts` | 同上 | 同上常量 |
| `services/src/paths.ts:235-236` `copyDataDirectory` | `.zcode/v2`（迁移功能因此完全失效） | `DATA_ROOT_DIR_NAME` |
| `services/src/storage/adapters/rootsResolver.ts:9` | `ZCODE_DATA_DIR_NAME = ".zcode"` | `.polaris` |
| `services/src/zcode-agent/zcodeAgentService.ts:465` | 双嵌套 `~/.polaris/.zcode/...` | 数据根 |
| `services/src/zcode-agent/modelTrajectoryFileTail.ts:18-19` | 读 `~/.zcode/cli` | 与写入方对齐 |
| `apps/zcode-cli/.../cli/src/provider-runtime-env.ts:76,81,140` | `<dataBaseDir>/.zcode/v2` | 与桌面写入方对齐 |
| `desktop/src/main/desktopRuntimeEnv.ts:498` | `ZCODE_HOME` 兜底 `~/.zcode` | `.polaris` |
| `services/src/node.ts:1072,1800`、`runtime-tools/providerRuntimeResolver.ts:62,90`、`device/deviceMid.ts:25,32`、`telemetry/telemetryCore.ts:130,137` | 同上 | 同上 |
| `apps/zcode-cli/.../adapters/src/auth/shared-credentials.ts:289` | `~/.zcode/v2/credentials.json` | `.polaris` |
| `services/src/{commands,hooks,mcp-sync,plugin-sync,skill-sync,skills,subagents,settings-sync}/*.ts` | 约 25 处数据根字面量 | `.polaris` |
| `desktop/src/main/exportLogs.ts` | 从 `.zcode` 收集日志 | 从 Polaris 根收集 |

> **副作用提醒**：设置文件位置一变，之前累积在 `~/.zcode/v2/setting.json` 的
> `recentProjects` / 外观设置等不会再被读到（等于按「干净起步」重来）。这符合既定策略。

---

## 3. 用户可见品牌残留（未修，逐项确认后再动）

### 3a. 系统级身份（可见度最高）

| 位置 | 现值 | 建议 |
|---|---|---|
| `desktop/src/main/desktopRuntimeEnv.ts:63` | `runtimeApplicationName` 原为 `"ZCode"` / `"ZCode Dev"` / `"ZCode Preview"`，被 `app.setName`(`index.ts:262`)、`process.title`(`:275`)、macOS 应用菜单(`desktopApplicationMenu.ts:114`) 使用 | **已修**为 `Polaris` / `Polaris Dev` / `Polaris Preview`。注意它同时决定 Electron userData 目录名（`%APPDATA%/Polaris`），此前与官方 `%APPDATA%/ZCode` 是同一个目录 |
| `desktop/electron-builder.config.js:459,461,462,703` | `homepage: zcode.z.ai`、`author: ZCode <dev@zcode.z.ai>`、Linux `maintainer` | 改 Polaris |
| `desktop/src/renderer/cua-permission-panel.html:5,123` | `<title>ZCode Computer Use</title>` | 改 Polaris |
| `desktop/src/main/desktopLinuxDeepLinkRegistration.ts:14,112` | `.desktop` 的 `Comment=` / 默认 `productName` | 改 Polaris |
| `packages/web/index.html:15`、`web/src/main.tsx:99,124,418,449` | 浏览器标题 `ZCode` / `ZCode - Sign In` / `ZCode 会话分享` | 改 Polaris |
| `shared/src/desktopMenu.ts:96-100,148-152`、`desktop/src/main/desktopCommandHandlers.ts:311,324,363,660` | 菜单与弹窗里的 `ZCode Endpoint` | 改 Polaris |
| `services/src/runtime-tools/appCaCert.ts:64-65` | 自签 CA `commonName: "ZCode Network CA"`，会进系统证书库 | 改 Polaris |
| `desktop/src/main/desktopFinderOpenFolderWorkflow.ts:7-12,25` | macOS 快速操作 `Open in ZCode.workflow`、bundle id `dev.zcode.app.*` | 改 Polaris |
| `shared/src/process-names.ts:52`、`desktop/src/preload/index.ts:205` | 按标题 `"ZCode"` 判定渲染进程名 | 与窗口标题同步改 |
| `desktop/src/host/browserControlMainBridge.ts:141` | `name: "ZCode In-app Browser"` | 改 Polaris |
| `desktop/package.json:4,5` | `description` / `author` | 改 Polaris |
| `packages/web/{index.html,src/main.tsx}`、`web/src/share/*`、`web/src/auth/webAuthLocale.ts` | 浏览器标题、分享落地页 wordmark 与「去 ZCode 继续 / 下载 ZCode」、登录页 brand | **已修** |
| `packages/desktop/src/renderer/cua-permission-panel.html` | `<title>` / `.name` | **已修** |
| `packages/shared/src/desktopMenu.ts`、`process-names.ts` | 「ZCode Endpoint」菜单标签；进程名靠窗口标题 `"ZCode"` 判定 | **已修**（进程名同时认 `ZCode`/`Polaris` 两种标题） |

### 3b. UI 文案

| 位置 | 现值 |
|---|---|
| `ui/i18n/locales/zh-CN.ts:2901,2902`、`en-US.ts:3098,3099` | `presetTitle` = **「智谱」**、`presetDescription` = 「内置 Z.ai 与 BigModel 供应商，支持通过 OAuth 辅助完成配置。」——最扎眼的一处 |
| `zh-CN.ts:2282` | `templateGroup.zhipu` = 「智谱」 |
| `zh-CN.ts:2272` | `namePlaceholder` = 「如：智谱 GLM」 |
| `zh-CN.ts:1839`、`en-US.ts:1950` | 「路径后缀 **.zcode**/v2 不可更改」——现在已是 `.polaris`，**文案错误** |
| `web/src/auth/webAuthLocale.ts:21,36`、`web/src/share/ConversationShareLandingPage.tsx` 多处 | 登录页与分享页 wordmark / 「去 ZCode 继续」/「下载 ZCode」 |
| `ui/src/lib/builtinSkillI18n.ts:57,59,117,118,160,162` | 技能描述里的「控制 ZCode 内置浏览器」等 |
| `ui/src/v4/conversationProjectionStore.ts:47,69-72`、`ui/src/lib/zcodeUiError.ts:23` | 用户可见错误文案 `ZCode agent runtime 已被回收`（与 CLI 侧错误串**前缀匹配**，必须两边一起改） |
| `ui/src/lib/codingPlanUsageSources.ts:44,216`、`CodingPlanUsageRemainingPanel.tsx:114`、`WorkspaceSidebarFooterUsageSummary.tsx:100`、`V4ComposerToolbar.tsx:569` | 侧栏/底栏/工具栏的 `Z.ai - Coding Plan` 徽标 |
| `shared/src/plugin-display-name.ts:6` | `zcode: "ZCode"` 缩写表 |
| `services/src/usage-stats/providers/bigmodelUsageQuotaProvider.ts:1594` | 服务层返回的展示名 `Z.ai - Coding Plan` |

### 3c. CLI 文案

`apps/zcode-cli/packages/i18n/src/locales/{zh-CN,en-US}.ts` 的启动横幅
（`starting: "正在启动 ZCode…"`）、`/login`、`/logout`、`callouts.*` 里的
`Z.AI / BigModel Coding Plan` 标签；`cli/src/{login-command.ts,command-center/*}.ts` 的
`Usage: zcode login`、`Z.AI Coding Plan is not available in this client.` 等。

### 3d. 低优先

- `desktop/scripts/desktop-product-identity.mjs:94` —— dev 模式 Windows AUMID 仍是 `cn.aminer.zcode`（打包态正确用 `com.bitlesu.polaris`）。
- `shared/src/zcode-slash-command-help.ts:23,32,34,52` —— `/init` 帮助里写 `~/.zcode/AGENTS.md`。
- `shared/src/model-provider-family.ts:33,43` —— `rootDomain: "z.ai" / "bigmodel.cn"`，只被**无调用方**的 `resolveModelProviderFamilyIdByBaseURL` 使用，等于死代码（`label` 字段仍在用）。
- `desktop/src/main/desktopCrashCapture.ts:20` `https://zcode.invalid/...` —— `.invalid` 保留域，永不解析，**保留**。
- `shared/src/official-mcp-auth.ts:18-33` —— 跨语言协议常量 `com.zcode/official-mcp-auth`、`X-Bigmodel-Authorization`，改动即破坏协议，**保留**。

---

## 4. 契约型路径（建议不动，需你拍板才能改）

这些改了就破坏既有磁盘/链接/远端契约：

| 项 | 位置 | 不改的理由 |
|---|---|---|
| `zcode://` URL scheme | `shared/src/platform.ts:678`、`services/src/oauth/oauthService.ts:40`、`web/src/share/*`、`electron-builder.config.js:654` | 已分发的分享链接 / deep link 会失效。彻底改需要 `polaris://` + 双注册过渡 |
| `.zcode-plugin/plugin.json` | `commandsService.ts:49`、`pluginSyncService.ts:78`、`settingsSyncService.ts:414`、`skillsService.ts:57`、`subagentsService.ts:85`、`server/src/remote/*` | 插件作者遵循的**格式契约** |
| `.zcodeignore` | `file/workspaceFileIgnore.ts:19` + i18n | 用户仓库里已有的文件，改名即失效 |
| `.zcode-share` / `.zcode-share-import.json` | `conversationShareService.ts:730,1390,1392,1717,2171,2176` | 分享导入格式 |
| `.zcode-install-manifest`、`Icon=zcode`、`zcode-window-bounds` | `electron-builder.config.js:167,188,576,699-701` | 安装器元数据 |
| 远程 `~/.zcode/server` | `server/src/remote/deployShared.ts:7`、`connect.ts:365,391`、`docker-backend.ts:87` | 已部署到 SSH 主机的 agent 路径 |
| Electron `partition` 名（`zcode-embedded-browser` 等）、`ai.z.zcode` AppData key | `desktop/src/main/mcpUserDirectory/*` | 已存在的浏览器 profile / 用户数据键 |
| SSH 端 `~/.zcode/tmp/prompt-attachments` | `desktop/src/host/remotePromptAttachments.ts:6-7` | 远端契约 |

---

## 5. 已完成 / 待办

**已完成（本轮）**

- §2 数据根泄漏（真 bug）：用户级路径全部 `.polaris`，含桌面、services、CLI 的读**与**写两侧。
- §1a 的官方端点里，`config/default.json` 的 `feedback_url` / `community_urls` 已改指
  `polaris.bitlesu.com`（反馈提交端点本来就已走自有 origin）。
- 品牌漏项：应用主界面 logo（`App.tsx` + `WindowsTopLeftLogo`）此前仍是 **Z.AI logo**，已换成
  Polaris 占位星标 `assets/provider-icons/logo-polaris.svg`。
- 死素材：`packages/ui/src/assets/payment-icons/`（0 引用，支付 UI 已空壳化）已删。
- **阿里云 ARMS RUM SDK 已移除**：新增 `packages/desktop/src/main/telemetrySink.ts` 顶替，
  调用面不变（`init` / `sendCustom` / `sendEvent` / `setConfig` / `getConfig` / `client.useReporter`），
  九个采集模块与过滤/归因/脱敏链路一行未改；同时删掉 `patches/@arms__rum-electron@0.0.3.patch`
  与 lockfile 条目。产物验证：主进程 bundle 里 `@arms` 出现次数 **9 → 0**，打包少约 4.8MB。
  接自有后端时只改 `telemetrySink.ts`（挂 reporter / 实现 flush 目标）。
- §3a 系统身份：`runtimeApplicationName`（app 名 + userData 目录）、托盘/关于框/强制升级弹窗、
  macOS 应用菜单、窗口标题、分享落地页、登录页 brand、CUA 面板标题、`ZCode Endpoint` 菜单标签。
- 连带修复：`process-names.ts` 之前只认窗口标题 `"ZCode"`，改名后主渲染进程名会退化成标题本身，
  现已同时认 `ZCode` / `Polaris`。

**待办（未动，按优先级）**

1. **§1a 剩余出网请求**（4 处）—— `coding-plan-api-key.ts`（`zcode login zai`）与
   `legacyZCodeConfigProviderReader.ts`（导入旧 config 的生产兜底）会真把请求打到
   `api.z.ai` / `open.bigmodel.cn`；`official-plugin-definitions.ts` 的 8 个内置插件图标仍指向
   `cdn-zcode.z.ai`；`desktopMainIpcRemote.ts` / `desktopWindowChrome.ts` 白名单里还硬编码
   `https://api.z.ai`（只是放行，不主动请求）。
2. **§3b UI 文案** —— 「智谱」`presetTitle`、`templateGroup.zhipu`、`namePlaceholder`、
   技能描述、侧栏 `Z.ai - Coding Plan` 徽标、`conversationProjectionStore` 错误文案（需与 CLI 同步改）。
3. **§3c CLI 文案** —— `i18n` 里的 `/login` `/logout`、`callouts.*`、启动横幅等。
4. **§3d 低优先** —— dev AUMID `cn.aminer.zcode`、`zcode-slash-command-help.ts` 等。
5. **§4 契约项** —— 需要单独决策，尤其 `zcode://` scheme 是否改 `polaris://`。
6. **命名的历史包袱**（功能无影响，属整洁性）：`appARMSBootstrap.ts`、`armsEventRedaction.ts`、
   `armsRumShared.ts`、`armsUserIdentity.ts` 文件名与 `*ToArms` 函数名仍带 ARMS；
   `appARMSBootstrap.ts` 的 `armsInitPromise` 已改名 `telemetryInitPromise`，其余留待统一整理。

## 6. 决策记录（本轮）

| 项 | 决定 |
|---|---|
| 左侧「内置供应商」栏位（`PRESET_PROVIDER_SPECS` 被清空） | **等 owner 提供中转站 baseUrl 再做**：届时把智谱系 4 条模板改写成 Polaris 自有模板（方案 B）。在此之前维持现状——内置模板走「添加供应商 → 选模板」 |
| 阿里云 ARMS RUM SDK（4.8MB） | **已移除** |
