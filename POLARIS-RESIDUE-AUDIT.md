# Polaris 残留巡检报告（2026-09-23）

> 只读审计 + 已确认的修复。凡是**会破坏既有磁盘/协议契约**的地方都只记录、不改，等你拍板。

## 结论速览

| 分类                                | 数量                                                                    | 处置                                                          |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| 官方域名运行时请求                  | 4 处真请求 + 6 处潜伏/仅匹配键                                          | 见 §1（**未修**）                                             |
| **`~/.zcode` 数据根泄漏（真 bug）** | 约 60 处本地数据根                                                      | **已修复**（见 §2）                                           |
| 用户可见 ZCode / Z.ai 品牌残留      | 约 40 处                                                                | **应用名 / 窗口标题 / 分享页 / 托盘 / 关于框已修**，其余见 §3 |
| 契约型路径（不能改）                | `zcode://`、`.zcode-plugin/`、`.zcodeignore`、远程 `~/.zcode/server` 等 | 见 §4（**保留**）                                             |

---

## 1. 官方域名请求

### 1a. 真实出网（需要处理）

| 位置                                                                                 | 内容                                                                                                                                                                                                                  | 建议                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts:4`                 | `ZAI_API_HOST = "https://api.z.ai"` 硬编码，**没走** `resolveZaiBusinessBaseUrl()`；`:122` 会真发 `POST /api/auth/z/login`，`:97` 发 `/api/biz/...`。同文件 `:81` 的 bigmodel 分支已经用了 `resolveBigModelApiOrigin` | 改指 `resolveZaiBusinessBaseUrl(process.env)` |
| `apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts:58`        | `OFFICIAL_PLUGIN_ASSETS_BASE_URL = "https://cdn-zcode.z.ai/zcode/official-plugin/assets"`，给 8 个内置插件当地 `icon` URL 用（`:114` `:138` `:171` `:211` `:231` `:283` `:304` `:349`）                               | 本地化素材，或改指 `polaris.bitlesu.com/cdn`  |
| `config/default.json:2`                                                              | `feedback_url` = 智谱飞书表单                                                                                                                                                                                         | 改指自有（或确认就是要发官方）                |
| `config/default.json:5,6`                                                            | `community_urls` = 飞书邀请 + `discord.gg/z9aBcQXZQ3`                                                                                                                                                                 | 改指自有社群（UI 入口已隐藏）                 |
| `packages/services/src/model-provider/legacyZCodeConfigProviderReader.ts:64`         | `BIGMODEL_CODING_PLAN_ANTHROPIC_BASE_URL = "https://open.bigmodel.cn/api/anthropic"`，作为**生产**兜底 baseUrl（`:71-73` `:79` `:88-90`）；导入旧 ZCode `config.json` 时会把请求打到 `open.bigmodel.cn`               | 改指 `resolveBigModelApiOrigin()`             |
| `packages/desktop/src/main/desktopMainIpcRemote.ts:79`、`desktopWindowChrome.ts:293` | 内嵌 webview 导航白名单里硬编码 `"https://api.z.ai"`                                                                                                                                                                  | 删掉这条（默认已指向 polaris）                |
| `apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts:4`                           | `DEFAULT_ZCODE_OAUTH_BASE_URL = "https://zcode.z.ai/api/v1"`（当前被调用方注入的 baseUrl 覆盖，属潜伏）                                                                                                               | 默认值改指 polaris                            |

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

| 位置                                                                                                                                                  | 原                                  | 改为                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------- |
| `services/src/setting/settingService.ts`                                                                                                              | `<home>/.zcode/v2`                  | `DATA_ROOT_DIR_NAME` |
| `desktop/src/main/index.ts:532`                                                                                                                       | `homedir()/.zcode/v2/setting.json`  | 同上常量             |
| `desktop/src/main/desktopChromiumHardwareAccelerationBootstrap.ts`                                                                                    | 同上                                | 同上常量             |
| `services/src/paths.ts:235-236` `copyDataDirectory`                                                                                                   | `.zcode/v2`（迁移功能因此完全失效） | `DATA_ROOT_DIR_NAME` |
| `services/src/storage/adapters/rootsResolver.ts:9`                                                                                                    | `ZCODE_DATA_DIR_NAME = ".zcode"`    | `.polaris`           |
| `services/src/zcode-agent/zcodeAgentService.ts:465`                                                                                                   | 双嵌套 `~/.polaris/.zcode/...`      | 数据根               |
| `services/src/zcode-agent/modelTrajectoryFileTail.ts:18-19`                                                                                           | 读 `~/.zcode/cli`                   | 与写入方对齐         |
| `apps/zcode-cli/.../cli/src/provider-runtime-env.ts:76,81,140`                                                                                        | `<dataBaseDir>/.zcode/v2`           | 与桌面写入方对齐     |
| `desktop/src/main/desktopRuntimeEnv.ts:498`                                                                                                           | `ZCODE_HOME` 兜底 `~/.zcode`        | `.polaris`           |
| `services/src/node.ts:1072,1800`、`runtime-tools/providerRuntimeResolver.ts:62,90`、`device/deviceMid.ts:25,32`、`telemetry/telemetryCore.ts:130,137` | 同上                                | 同上                 |
| `apps/zcode-cli/.../adapters/src/auth/shared-credentials.ts:289`                                                                                      | `~/.zcode/v2/credentials.json`      | `.polaris`           |
| `services/src/{commands,hooks,mcp-sync,plugin-sync,skill-sync,skills,subagents,settings-sync}/*.ts`                                                   | 约 25 处数据根字面量                | `.polaris`           |
| `desktop/src/main/exportLogs.ts`                                                                                                                      | 从 `.zcode` 收集日志                | 从 Polaris 根收集    |

> **副作用提醒**：设置文件位置一变，之前累积在 `~/.zcode/v2/setting.json` 的
> `recentProjects` / 外观设置等不会再被读到（等于按「干净起步」重来）。这符合既定策略。

---

## 3. 用户可见品牌残留（未修，逐项确认后再动）

### 3a. 系统级身份（可见度最高）

| 位置                                                                                                     | 现值                                                                                                                                                                                         | 建议                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/src/main/desktopRuntimeEnv.ts:63`                                                               | `runtimeApplicationName` 原为 `"ZCode"` / `"ZCode Dev"` / `"ZCode Preview"`，被 `app.setName`(`index.ts:262`)、`process.title`(`:275`)、macOS 应用菜单(`desktopApplicationMenu.ts:114`) 使用 | **已修**为 `Polaris` / `Polaris Dev` / `Polaris Preview`。注意它同时决定 Electron userData 目录名（`%APPDATA%/Polaris`），此前与官方 `%APPDATA%/ZCode` 是同一个目录 |
| `desktop/electron-builder.config.js:459,461,462,703`                                                     | `homepage: zcode.z.ai`、`author: ZCode <dev@zcode.z.ai>`、Linux `maintainer`                                                                                                                 | 改 Polaris                                                                                                                                                          |
| `desktop/src/renderer/cua-permission-panel.html:5,123`                                                   | `<title>ZCode Computer Use</title>`                                                                                                                                                          | 改 Polaris                                                                                                                                                          |
| `desktop/src/main/desktopLinuxDeepLinkRegistration.ts:14,112`                                            | `.desktop` 的 `Comment=` / 默认 `productName`                                                                                                                                                | 改 Polaris                                                                                                                                                          |
| `packages/web/index.html:15`、`web/src/main.tsx:99,124,418,449`                                          | 浏览器标题 `ZCode` / `ZCode - Sign In` / `ZCode 会话分享`                                                                                                                                    | 改 Polaris                                                                                                                                                          |
| `shared/src/desktopMenu.ts:96-100,148-152`、`desktop/src/main/desktopCommandHandlers.ts:311,324,363,660` | 菜单与弹窗里的 `ZCode Endpoint`                                                                                                                                                              | 改 Polaris                                                                                                                                                          |
| `services/src/runtime-tools/appCaCert.ts:64-65`                                                          | 自签 CA `commonName: "ZCode Network CA"`，会进系统证书库                                                                                                                                     | 改 Polaris                                                                                                                                                          |
| `desktop/src/main/desktopFinderOpenFolderWorkflow.ts:7-12,25`                                            | macOS 快速操作 `Open in ZCode.workflow`、bundle id `dev.zcode.app.*`                                                                                                                         | 改 Polaris                                                                                                                                                          |
| `shared/src/process-names.ts:52`、`desktop/src/preload/index.ts:205`                                     | 按标题 `"ZCode"` 判定渲染进程名                                                                                                                                                              | 与窗口标题同步改                                                                                                                                                    |
| `desktop/src/host/browserControlMainBridge.ts:141`                                                       | `name: "ZCode In-app Browser"`                                                                                                                                                               | 改 Polaris                                                                                                                                                          |
| `desktop/package.json:4,5`                                                                               | `description` / `author`                                                                                                                                                                     | 改 Polaris                                                                                                                                                          |
| `packages/web/{index.html,src/main.tsx}`、`web/src/share/*`、`web/src/auth/webAuthLocale.ts`             | 浏览器标题、分享落地页 wordmark 与「去 ZCode 继续 / 下载 ZCode」、登录页 brand                                                                                                               | **已修**                                                                                                                                                            |
| `packages/desktop/src/renderer/cua-permission-panel.html`                                                | `<title>` / `.name`                                                                                                                                                                          | **已修**                                                                                                                                                            |
| `packages/shared/src/desktopMenu.ts`、`process-names.ts`                                                 | 「ZCode Endpoint」菜单标签；进程名靠窗口标题 `"ZCode"` 判定                                                                                                                                  | **已修**（进程名同时认 `ZCode`/`Polaris` 两种标题）                                                                                                                 |

### 3b. UI 文案

| 位置                                                                                                                                                              | 现值                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ui/i18n/locales/zh-CN.ts:2901,2902`、`en-US.ts:3098,3099`                                                                                                        | `presetTitle` = **「智谱」**、`presetDescription` = 「内置 Z.ai 与 BigModel 供应商，支持通过 OAuth 辅助完成配置。」——最扎眼的一处 |
| `zh-CN.ts:2282`                                                                                                                                                   | `templateGroup.zhipu` = 「智谱」                                                                                                  |
| `zh-CN.ts:2272`                                                                                                                                                   | `namePlaceholder` = 「如：智谱 GLM」                                                                                              |
| `zh-CN.ts:1839`、`en-US.ts:1950`                                                                                                                                  | 「路径后缀 **.zcode**/v2 不可更改」——现在已是 `.polaris`，**文案错误**                                                            |
| `web/src/auth/webAuthLocale.ts:21,36`、`web/src/share/ConversationShareLandingPage.tsx` 多处                                                                      | 登录页与分享页 wordmark / 「去 ZCode 继续」/「下载 ZCode」                                                                        |
| `ui/src/lib/builtinSkillI18n.ts:57,59,117,118,160,162`                                                                                                            | 技能描述里的「控制 ZCode 内置浏览器」等                                                                                           |
| `ui/src/v4/conversationProjectionStore.ts:47,69-72`、`ui/src/lib/zcodeUiError.ts:23`                                                                              | 用户可见错误文案 `ZCode agent runtime 已被回收`（与 CLI 侧错误串**前缀匹配**，必须两边一起改）                                    |
| `ui/src/lib/codingPlanUsageSources.ts:44,216`、`CodingPlanUsageRemainingPanel.tsx:114`、`WorkspaceSidebarFooterUsageSummary.tsx:100`、`V4ComposerToolbar.tsx:569` | 侧栏/底栏/工具栏的 `Z.ai - Coding Plan` 徽标                                                                                      |
| `shared/src/plugin-display-name.ts:6`                                                                                                                             | `zcode: "ZCode"` 缩写表                                                                                                           |
| `services/src/usage-stats/providers/bigmodelUsageQuotaProvider.ts:1594`                                                                                           | 服务层返回的展示名 `Z.ai - Coding Plan`                                                                                           |

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

| 项                                                                               | 位置                                                                                                                                                     | 不改的理由                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `zcode://` URL scheme                                                            | `shared/src/platform.ts:678`、`services/src/oauth/oauthService.ts:40`、`web/src/share/*`、`electron-builder.config.js:654`                               | 已分发的分享链接 / deep link 会失效。彻底改需要 `polaris://` + 双注册过渡 |
| `.zcode-plugin/plugin.json`                                                      | `commandsService.ts:49`、`pluginSyncService.ts:78`、`settingsSyncService.ts:414`、`skillsService.ts:57`、`subagentsService.ts:85`、`server/src/remote/*` | 插件作者遵循的**格式契约**                                                |
| `.zcodeignore`                                                                   | `file/workspaceFileIgnore.ts:19` + i18n                                                                                                                  | 用户仓库里已有的文件，改名即失效                                          |
| `.zcode-share` / `.zcode-share-import.json`                                      | `conversationShareService.ts:730,1390,1392,1717,2171,2176`                                                                                               | 分享导入格式                                                              |
| `.zcode-install-manifest`、`Icon=zcode`、`zcode-window-bounds`                   | `electron-builder.config.js:167,188,576,699-701`                                                                                                         | 安装器元数据                                                              |
| 远程 `~/.zcode/server`                                                           | `server/src/remote/deployShared.ts:7`、`connect.ts:365,391`、`docker-backend.ts:87`                                                                      | 已部署到 SSH 主机的 agent 路径                                            |
| Electron `partition` 名（`zcode-embedded-browser` 等）、`ai.z.zcode` AppData key | `desktop/src/main/mcpUserDirectory/*`                                                                                                                    | 已存在的浏览器 profile / 用户数据键                                       |
| SSH 端 `~/.zcode/tmp/prompt-attachments`                                         | `desktop/src/host/remotePromptAttachments.ts:6-7`                                                                                                        | 远端契约                                                                  |

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
6. ~~**命名的历史包袱**~~ **已完成（本轮扫尾）**：ARMS 文件/符号全面去厂商化——
   `appTelemetryBootstrap.ts`、`telemetryUserIdentity.ts`、`telemetryEventRedaction.ts`、
   `desktopCustomTelemetryEvent.ts`、`desktopRemoteUsageTelemetry.ts`、`customEventObservability.ts`、
   `reactErrorTelemetry.ts`、`sendFunnelTelemetry.ts`、`sessionOpenTelemetry.ts`、`uiPerfTelemetry.ts` 等；
   `ArmsCustomEventPayload`→`CustomTelemetryEventPayload`、`reportArmsCustomEvent`→`reportCustomTelemetryEvent`；
   残余的 `@arms` RUM bridge preload 拦截（服务于已删 SDK）整体移除。

## 6. 决策记录（本轮）

| 项                                                       | 决定                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 左侧「内置供应商」栏位（`PRESET_PROVIDER_SPECS` 被清空） | **等 owner 提供中转站 baseUrl 再做**：届时把智谱系 4 条模板改写成 Polaris 自有模板（方案 B）。在此之前维持现状——内置模板走「添加供应商 → 选模板」                       |
| 智谱系内置模板（2026-09-26 更新）                        | 已按**「砍官方计费套餐、留自带 key 通道」**执行：删 `zai-api` / `bigmodel-api` 与 8 条 `account:*` provider；保留 `zai-standard-api` / `bigmodel-standard-api`。详见 §7 |
| 阿里云 ARMS RUM SDK（4.8MB）                             | **已移除**                                                                                                                                                              |

---

## 7. 本轮：官方计费套餐与出网路径砍除（2026-09-26）

> 决策前提：**自有 AI 服务端尚未就绪**，因此不做「改指自有」的占位接入，能砍的直接砍；
> 等自有服务上线后再按「方案 B」接回。

### 7a. 内置 provider 配置（`config/provider/zcode-builtin.json`，revision 30 → 31）

| 处置     | 内容                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **删除** | 2 条官方计费模板：`zai-api`（Z.ai Coding Plan）、`bigmodel-api`（BigModel Coding Plan）。二者 access type 为 `zhipu-coding-plan-api-key`，绑定官方账号与计费                                                      |
| **删除** | 8 条官方账号 provider，`providerRules` 清空：`account:{zai,bigmodel}-{individual,team}-coding-plan`、`account:{zai,bigmodel}-start-plan`、`account:{zai,bigmodel}-offpeak-idle-plan`                              |
| **删除** | 上述 6 条对应 `templateModelRules`                                                                                                                                                                                |
| **保留** | 剩余 18 条模板：16 条第三方（moonshot / minimax / deepseek / qwen×2 / xiaomi / openai / anthropic / xai / openrouter / opencode×6）+ 2 条**自带 API Key 的标准通道** `zai-standard-api` / `bigmodel-standard-api` |
| **保留** | `access.type` 枚举与 `account:*` 常量全部留在代码里（`provider/src/config/*`、`shared/src/model-provider-types.ts`、`provider-selection-v2` 迁移别名、`official-glm-selection-v3` SQL）——接口契约不动             |

红线遵守：第三方 API Key 通道（含 GLM 自带 key）一条未动；`model-provider/` 抽象层文件未改。

### 7b. 官方出网路径收口

| 位置                                                                          | 处置                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts`                      | **关闭**。删除硬编码 `https://zcode.z.ai/api/v1` 与 `/oauth/cli/*` 全部请求实现；工厂被调用即抛 `CliOAuthError`，类型/错误类保留                                            |
| `apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts`            | **关闭**。删除 `ZAI_API_HOST = "https://api.z.ai"` 与 `/api/biz/...` 实现；工厂即抛 `CodingPlanApiKeyError`                                                                 |
| `packages/services/src/model-provider/legacyZCodeConfigProviderReader.ts`     | 删除生产分支兜底。旧 config 里保存的官方域名一律改指 `resolveBigModelApiOrigin()`；原常量降级为**匹配键**（不再作为请求地址）                                               |
| `packages/desktop/src/main/desktopMainIpcRemote.ts`、`desktopWindowChrome.ts` | webview 白名单里的 `"https://api.z.ai"` 已删，只放行自有网关的 PayPal 中转地址                                                                                              |
| `apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts`    | `cdn-zcode.z.ai` 图标全部移除（8 处），插件 author 由 `Z.ai` 改为 `Polaris`。图标改由 `ui/src/lib/pluginIconSource.ts` 的打包素材按插件 id 命中，未命中时降级为中性占位图标 |
| `apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts`  | **保留**。官方 baseUrl 只作路由匹配键，出网地址在 `:59-63` 改写为自有 origin                                                                                                |

### 7c. 文案

- `ui/i18n`：`presetTitle`「智谱」→「内置供应商」/「Built-in providers」；`presetDescription` 去掉「内置 Z.ai 与 BigModel 供应商，支持通过 OAuth 辅助完成配置」；`presetEmpty` 去掉 OAuth 提示；`namePlaceholder`「如：智谱 GLM」→「如：GLM-5.3」。
- **有意保留**：`templateGroup.zhipu`（「智谱」/「Zhipu」）、`login.apiKey.provider.zai`（「Z.ai」）等**第三方厂商名**——它们是这些 API 的真实提供方，改成 Polaris 会造成名实不符。
- `ProviderTemplatePicker` 的 zhipu 分组由 4 条收敛为 2 条自带 key 模板。

### 7c-2. 智谱系彻底清除（2026-09-26 第二刀，约 4000 行）

用户在运行态看到「内置两个：BigModel 与 Z.ai」后决定**全砍**（推翻 7a 的「留自带 key 通道」）：

| 处置                     | 内容                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **删除**                 | 最后两条智谱系模板 `zai-standard-api` / `bigmodel-standard-api` + 48 条模板模型规则；内置模板只剩 16 条第三方（revision 32）                                                                                                    |
| **删除**                 | `usage-stats/providers/` 全部 6 个文件（含 1606 行的 `BigModelUsageQuotaProvider`）、`model-provider/zaiStartPlanBilling.ts`、dead code `bigmodelStartPlanZcodeJwt.ts`                                                          |
| **改写为不使用官方链路** | `usageStatsService`：只保留 `getAppUsageSnapshot`（读本机 agent 数据库）；Coding Plan 四个方法抛 `coding_plan_removed`，`getEntitlementSnapshot` 返回 `not_configured` 空态（避免常驻请求报错），接口 `IUsageStatsService` 不变 |
| **连带清理**             | desktop host 侧已无人使用的 `AccountRequestAuthService` / `AccountProviderCredentialService` / `OAuthCredentialRepo` 装配                                                                                                       |
| **保留**                 | `modelRules` 里以 `api.z.ai` / `open.bigmodel.cn` 为 `baseUrlMatch` 的条目 —— 它们是**静态匹配键**而非请求，且用户自建 provider 指向同一网关时仍需它们                                                                          |

**仍然存在（下一刀目标）**：`oauth/`（1841 行）与 `model-provider/accountProvider*`（约 1500 行）仍由 `node.ts` 装配，
`oauthService` 被 10 处 UI 引用（`useCredentials` / `useTokenRefresh` /
`providerFamilyDomainMigration` / `useRootOAuthEffects` / `useRootWorkspaceActions` / `ModelProviderSection`），
启动时仍会跑 `restoreOAuthSession` 与 `shouldOpenLoginEntry`。需按「保留接口、改空壳」接续处理。

### 7d. 验证

`pnpm typecheck` ✅ 0 错误；CLI `turbo run typecheck` ✅ 27/27；`pnpm lint` ✅ 0 errors（79 warnings 均为既有）；CLI lint 侧报错为**既有**（core / contracts / telemetry 等，本轮改动文件 0 命中）。

---

## 8. 本轮：启动残留链路收口（2026-09-26 第三刀）

> 目标：把「启动时必定打一次失败远端请求」的残留链路改为**空实现**（保留接口与装配签名），
> 顺手清掉混在错误串里的品牌残留。自有 AI 服务端未就绪期间，这些接口的真实实现应在接自有后端时补回。

### 8a. 客户端场景（首页推荐词 / Automations 模板目录）

| 位置                                                         | 处置                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/services/src/client-scenes/clientScenesService.ts` | 由「请求官方 `/api/v1/client/scenes`」改为**空实现**：`list()` 直接返回 `{ code: 0, msg: "", data: [] }`，不发网络、不抛错。接口 `IClientScenesService` 与工厂签名（依赖对象 `apiClient`）保持不变 |

效果：启动不再出现 `[v4-suggested-prompts] Client scenes 请求失败，推荐列表保持为空`；
首页推荐词与 Automations 模板目录稳定收敛为空态（自有后端上线后在这里实现 `list()` 即可）。

### 8b. 品牌残留

| 位置                                                        | 原                                                      | 改为                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/provider-node/src/zcode-builtin-download.ts`      | 错误串 `ZCode Built-in client-config: invalid response` | `Polaris Built-in …`（会经 `provider-settings.refresh` 冒到 UI 日志） |
| `apps/zcode-cli/packages/i18n/src/locales/{zh-CN,en-US}.ts` | CLI 启动横幅 `正在启动 ZCode…` / `Starting ZCode...`    | `正在启动 Polaris…` / `Starting Polaris...`                           |

### 8c. 死代码 / 无用日志

| 位置                                              | 处置                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/desktopHostProcess.ts` | 删除 `[spawnHostProcess] BIGMODEL_OAUTH_APP_SECRET source: …` 日志行——该 secret 在仓库中已无任何消费点，仅此一行引用，且不该在日志里点名 secret      |
| `packages/shared/src/model-provider-family.ts`    | 删除死代码 `resolveModelProviderFamilyIdByBaseURL` 与 `ModelProviderFamilySpec.rootDomain`（`rootDomain: "z.ai" / "bigmodel.cn"`）——审计确认零调用方 |

### 8d. 仍然存在（下一刀目标，按优先级）

1. **Built-in Config 远端刷新**（`node.ts:1534`）—— 自有后端未就绪，仍会每次失败一次。属**既定行为**；
   接自有后端后自动恢复。相关装配 `providerConfigRuntime` / `zcodeBuiltinRemoteConfig` 属抽象层，本轮未动。
2. ~~**Coding Plan 业务 UI**（约 60 文件）~~ **已完成（本轮扫尾）**：整层删除——设置页套餐导航/状态卡/
   购买横幅、侧栏套餐徽标、额度横幅栈、composer 额度面板、使用统计套餐 tab、Start Plan 推荐、
   升级弹窗机制（seam 由 Nimbus 账号弹窗直接承接）全部移除；i18n 同步清掉 532 个死键。
   保留的 seam：`ICodingPlanSubscriptionService`（空实现）、闲时任务 UI/服务、`ZCODE_TELEMETRY_RUM_ENDPOINT`。
3. **OAuth / `accountProvider*` 装配**（`node.ts` 仍装配约 3300 行）——启动会跑 `restoreOAuthSession`
   与 `shouldOpenLoginEntry`；拟按「保留接口 + 空壳实现」处理。
4. **CLI 官方登录**（`login-command.ts` / `bootstrap/auth-login.ts` 410 行 / `tui-auth.ts` / `command-center/login-flow.ts`）
   —— 目前仅关闭为可读错误，尚未删除；`i18n` 里 `/login` `/logout` `callouts.*` 的同源文案一并待清。
5. **`.env.example`** 仍写官方域名参考（改指 `polaris.bitlesu.com`）；编辑工具对 `.env*` 有写保护，需手工替换。

### 8e. 验证

`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors（80 warnings 均为既有）；
CLI `@zcode/i18n` 单独 `tsc --noEmit` ✅ 通过（`turbo run typecheck` 里 i18n 报 `EEXIST`/`EBUSY`
为 Windows 下 pnpm tool 目录软链竞态，属环境问题，非代码错误）。

---

## 9. 本轮：OAuth 服务空壳化（2026-09-26 第四刀）

> 前置事实：官方 provider 适配器此前已恒为 `[]`（`runtimeConfig` 返回 `providers: []`），
> 因此 `restoreCachedSessionState` 在运行态**已经恒定返回 `signed-out`**，provider 授权码/polling/token
> 刷新等分支全部不可达。本刀删掉这些不可达实现，保留接口与装配签名。

### 9a. 处置

| 文件                                          | 处置                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/services/src/oauth/oauthService.ts` | 1223 行 → 空壳实现：接口 `IOAuthService` 与工厂 `createOAuthService(credentialService, deps)` 签名不变；`getProviders/getActiveProvider/restoreCachedSession/restoreSession/pollPendingOAuth/handleCallback` 返回空，`restoreCachedSessionState` 恒返回 `signed-out`，`startOAuth/startOAuthWithPolling` 抛可读错误，`logout/logoutAll/refreshToken/cancelPending` 无操作；保留非接口方法 `logoutIfCurrentCredentialRequest`（恒返回 false，不触发 JWT 失效广播） |
| `oauth/oauthProfileSchema.ts`（148 行）       | **删除**（仅被 oauthService 引用）                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `oauth/callbackAttribution.ts`（22 行）       | **删除**（仅被 oauthService 引用；desktop 侧另有同名局部函数，不受影响）                                                                                                                                                                                                                                                                                                                                                                                          |
| `oauth/providerAdapter.ts`（47 行）           | **删除**（仅为已移除适配器的类型契约，无引用方）                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `oauth/runtimeConfig.ts`（33 行）             | **删除**（原为官方 provider 运行时配置构造，无引用方）                                                                                                                                                                                                                                                                                                                                                                                                            |

**保留（接自有账号时的 seam）**：`oauth/oauth.ts`（`IOAuthService` 接口）、
`oauth/repo/oauthCredentialRepo.ts`（通用凭据仓库，node.ts 仍在用于 onboarding userId / 账号身份）、
`oauth/oauthUnauthorizedRequest.ts`（401 分类，apiClient 引用）、
`oauth/oauthProviderLogout.ts`（派生 provider key 清理）。

净变更：约 **-1413 行**。`node.ts` / `remoteWorkspaceServiceCollection.ts` 装配点零改动（签名兼容）。

### 9b. 验证

`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors（80 warnings 均为既有）。

### 9c. `accountProvider*` 集群（2026-09-26 第五刀，已按分步方案完成）

> 处理原则：**空壳化插在红线链路里的服务，不动红线本身的构造签名。**

| 位置                                                  | 处置                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model-provider/accountRequestAuthService.ts`         | 改为**空壳**：`resolveAccessCurrent→null`、`resolveCurrent/assertCurrent→throw AccountRequestCredentialUnavailableError`。类型（含 `AccountRequestAuthResolver` / 错误类）与导出名全部保留，工厂改为无参                                                                                                                                                                               |
| `model-provider/accountProviderConnectionResolver.ts` | 344 行 → 空 overlay：`createAccountProviderConfigSource` 用 `createAccountProviderConfigResolver(async () => [])` 返回**零账号连接**，签名（`configSource`）不变。**保留它的原因**：Provider Runtime / Agent / Provider Provisioning 依赖这个第三层 Source，直接摘掉 `accountSource` 会改 Provider 抽象层构造签名（红线）                                                              |
| `oauth/oauthProviderLogout.ts`                        | 改为空壳：不再依赖 `accountProviderCredentialStore`，只保留 `refreshAccountProviders` 扩展点                                                                                                                                                                                                                                                                                           |
| `node.ts`                                             | 删除整条账号链装配（`accountProviderCredentialStore` / `AccountProviderApiClient` / `AccountProviderApiKeyResolver` / `accountProviderCredentialService` / `legacyTeamOrganizationResolver` / `readAccountProviderSettings` / `loadAccountIdentity` / `bindAccountProviderInvalidation` / `createCodingPlanFamilyAvailabilityResolver`），约 -149 行                                   |
| `desktop/remoteWorkspaceServiceCollection.ts`         | 去掉 `createAccountProviderCredentialStore` 装配                                                                                                                                                                                                                                                                                                                                       |
| **删除**                                              | `accountProviderRequestAuthService`、`accountProviderApiClient`、`accountProviderApiKeyResolver`、`accountProviderApiTypes`、`accountProviderCredentialService`、`accountProviderCredentialStore`、`accountProviderCredentialKey`、`accountProviderTeamPlanRequestKey`、`accountProviderInvalidation`、`codingPlanProviderAvailability`、`legacyTeamOrganizationResolver`（11 个文件） |

**行为等价性**：移除前因无任何 `zhipu-account` provider，`resolveAccessCurrent` 已恒定返回 null、
`resolveCurrent/assertCurrent` 已恒定抛 `AccountRequestCredentialUnavailableError`；空壳保持同一行为。

**保留的 seam**：`IAccountRequestAuthService` + 类型、`AccountProviderService` 第三层 Source 装配点、
`createOAuthProviderLogoutHandler` 扩展点、`providerProvisioning*`（含 `isProviderProvisioningAccountCredentialKey` 常量）。

净变更：约 **-1429 行**。验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors（80 warnings 既有）。

---

## 10. 本轮：CLI 官方登录编排空壳化（2026-09-26 第六刀）

| 位置                                                  | 处置                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/zcode-cli/packages/bootstrap/src/auth-login.ts` | 410 行 → 空壳（约 36 行）：保留全部导出类型与函数签名（`loginZCodeCli` / `loginBigmodelCodingPlan` / `configureCodingPlanApiKey` / `logoutZCodeCli` / `hasConfiguredStandaloneCodingPlan` / `ZCodeCliLoginError`），登录类入口一律抛可读 `ZCodeCliLoginError`；`logoutZCodeCli` 仍清共享凭据文件（纯本地操作） |
| `auth-login-polling.ts` / `auth-login-abort.ts`       | **删除**（仅被 auth-login 使用）                                                                                                                                                                                                                                                                               |

CLI 命令/TUI 接线（`login-command.ts` / `tui-auth.ts` / `cli-types.ts` / `command-center/*`）未改，只把错误在用户面前变成可读提示。

保留的 seam：`@zcode/adapters` 的 `CliOAuthClient` 类型与错误类、`createCodingPlanApiKeyResolver` 类型（工厂仍为可读错误）。

**仍未清**（下一刀候选）：`command-center/login-flow.ts`（仍构造 4 个现已必失败的登录选项）与 CLI i18n 的 `/login` `/logout` `callouts.*` 官方文案；
`standalone-account-provider-runtime.ts` 仍被 `process-provider-registry-runtime.ts` 使用，**不能**当登录专用件删。

验证：CLI `turbo run typecheck` ✅ 27/27；根 `pnpm typecheck` ✅ 0 错误。

---

## 11. 本轮：UI 层 OAuth 死链路收口（2026-09-26 第七刀）

OAuth 服务空壳化后，UI 层原来那套登录轮询 / deep-link 回调 / JWT 失效广播 / 登录后 family 校正
全部**不可达**，一并删除：

| 位置                                             | 处置                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ui/root/useRootOAuthEffects.ts`                 | 411 行 → 最小实现（约 80 行）：只保留「启动恢复登录态（恒未登录）」与「通知主进程渲染就绪」，对外 props 签名不变，`Root.tsx` 零改动 |
| `ui/root/oauthCachedSessionRestore.ts`           | **删除**（只被该 hook 使用）                                                                                                        |
| `ui/root/oauthLoginAttemptGuard.ts`              | **删除**（只被该 hook 使用）                                                                                                        |
| `ui/root/oauthProviderFamilySelectionRefresh.ts` | **删除**（只被该 hook 使用）                                                                                                        |
| `ui/root/oauthTeamPricing.ts`                    | **删除**（只被上者使用）                                                                                                            |

**保留**：`zcodeJwtInvalidRestartMarker.ts`（`Root.tsx` 仍 `consume`）、`providerFamilyDomainSettings.ts`
（`useRootWorkspaceActions` / `ModelProviderSection` 仍用）。

验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors（80 warnings 既有）。

---

## 12. 决策待定：Coding Plan UI 的保留/清除边界

用户提出关键问题：**若 Polaris 自己也推出套餐，UI 要不要留？**

分析结论（建议按「两层」处理）：

**A. 必须保留（自建套餐的 seam）**

- 服务接口：`ICodingPlanSubscriptionService`、`IUsageStatsService`（已完成空壳化，接口不变）。
- 与厂商无关的用量展示：`CodingPlanUsagePanel` + 用量图表、`chat-input-toolbar/*`（上下文/额度显示）、
  `WorkspaceSidebarFooterUsageSummary`、`useUsageStats` / `usePlanIdentitySnapshot`。
- 购买弹窗的**壳**：`CodingPlanUpgradeDialog(Provider)` 的上下文/开关机制。

**B. 建议清除（官方专属，自建套餐时必重写）**

- 企业/团队定价：`oauthTeamPricing`（已删）、`enterpriseCodingPlanProducts`、
  `useEnterpriseCodingPlanProducts`、`codingPlanEnterpriseTiers`。
- 官方免费档：`StartPlanBalanceCard` / `StartPlanQuotaStatusCard` / `useStartPlanPreview`。
- 官方购买 webview：`CodingPlanEmbeddedWebviewDialog` / `codingPlanEmbeddedWebview` /
  `codingPlanPurchaseAuth` / `codingPlanUpgradeLoginRecovery` / `codingPlanPricingCards`。
- 官方漏斗埋点：`codingPlanFunnelTelemetry`。
- 官方品牌残留：`BigModelRegistrationHint`。

**为什么不一刀切**：清除 B 需要改 `StatusCards.tsx`（987 行）、`Detail.tsx`（1231 行）、
`ModelProviderSection.tsx`、`SettingsPage.tsx`、`V4ComposerToolbar.tsx` 等中心文件，
属大重构；建议单独一刀、逐子块 typecheck 完成。

> **2026-09-29 更新：本节决策已执行完毕。** A 层 seam 全部保留（服务空实现、闲时任务、
> `UsageStatsSection` 通用应用用量）；B 层连同 §12 遗留的中心文件计划线分支一并移除，
> `Detail.tsx` / `StatusCards.tsx` / `ModelProviderSection.tsx` 已重写为「自定义供应商」专用视图。

---

## 13. 打包元数据与 CLI 官方网关改写层

### 13.1 打包元数据品牌残留（纯标识，零 agent 能力）

| 位置                                                                        | 处置                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/desktop/electron-builder.config.js` `extraMetadata.homepage`      | `https://zcode.z.ai` → `https://polaris.bitlesu.com`               |
| 同处 `author.name` / `email`                                                | `ZCode` / `dev@zcode.z.ai` → `Polaris` / `dev@polaris.bitlesu.com` |
| Linux `maintainer`                                                          | `ZCode <dev@zcode.z.ai>` → `Polaris <dev@polaris.bitlesu.com>`     |
| `resolveAppAsarPath` / `resolvePackagedResourcesDir` 的 `?? "ZCode"` 兜底名 | → `?? "Polaris"`                                                   |

注：`appId` 早已是 `com.bitlesu.polaris`（见 `scripts/desktop-product-identity.mjs`）；
邮箱沿用自有域名，如后续有正式对外邮箱可再替换。

### 13.2 CLI 官方 Coding Plan 网关改写层（已不可达，删除）

`apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts` 只在模型请求 URL 精确命中
`open.bigmodel.cn/api/anthropic/v1/messages` 或 `api.z.ai/api/anthropic/v1/messages` 时，把请求改写为
经 ZCode 平台网关发送（做官方套餐权益校验）。官方 provider 已全部移除，这两个端点不再被任何模板引用，
该改写层成为死代码。

| 位置                                                         | 处置                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `model/official-coding-plan-gateway.ts`                      | **删除**（含 `OFFICIAL_CODING_PLAN_GATEWAY_ROUTES`）               |
| `model/adapters/index.ts`                                    | 移除对应 `export *`                                                |
| `model/model-execution.ts`                                   | 移除 import 与 `createProviderTransportFetch` 包装；模型出口直接走 |
| `createProviderProxyFetch`（非官方 provider 行为 100% 不变） |

**为什么安全**：`createOfficialCodingPlanGatewayFetch` 对非官方端点一直是直通；删除后第三方/自建
provider 的请求路径与请求头完全一致，不触碰 agent 能力。

验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors；CLI `turbo run typecheck` ✅ 27/27。

---

## 14. CLI 官方登录选项 UI 与官方文案

`/login` 原先构建 4 个官方登录选项（Z.AI / BigModel 各一套 OAuth + API Key），但这些入口背后的
登录编排早已空壳化（调用恒抛可读错误），UI 只是给用户展示一串必然失败的官方选项，属于官方残留。

| 位置                                                                                                            | 处置                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `command-center/login-flow.ts`                                                                                  | 159 → 13 行：删除 `buildLoginSelection` / `formatLoginResult` /                          |
| `formatProviderSetupResult` / `emitLoginAuthorizeMessage` / `parseApiKeyLoginArgs`，只保留 `loginSetupResponse` |
| `command-center/create.ts`                                                                                      | `/login` 分支简化为返回一条稳定提示（不再构建选项 UI）；导入收窄；`/logout` 文案去官方化 |
| `command-center/types.ts`                                                                                       | 删除 `CommandCenterLoginResult` / `CommandCenterLoginAuthorizeData` /                    |

`CommandCenterLoginOptions` / `CommandCenterBigmodelLoginOptions(Result)` / `CommandCenterApiKeyOptions(Result)`
及 `CommandCenterDeps` 上对应的 `login` / `loginBigmodel` / `configureApiKey` 字段 |
| `tui-auth.ts` | 删除 `loginForTui` / `loginBigmodelForTui` / `configureApiKeyForTui`，仅保留 `logoutForTui`（纯本地凭据清理） |
| `tui-prompt-handler.ts` | 移除三个登录 deps 接线 |
| `login-command.ts` | `zcode logout` 文案去官方化 |
| i18n `types.ts` + `zh-CN.ts` + `en-US.ts` | `loginSetup` 只保留 `response`；`loginRequired` 文案去官方化；帮助文本里 `login/logout` 去 Z.AI 化 |

**保留 seam**：`bootstrap/src/auth-login.ts` 的 `loginZCodeCli` / `logoutZCodeCli` 空壳（`zcode login` /
`zcode logout` 命令仍接），自有账号服务上线后可在此接回。`loginZCodeCli` 调用仍会抛可读的
“Official account sign-in is not available in Polaris…” 错误。

**为什么安全**：删除的只是官方选项列表与官方文案；模型可用性检查（`createTuiModelAvailabilityChecker`）、
`/login` 引导、provider 配置能力均不受影响，不触碰 agent 能力。

验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors；CLI `turbo run typecheck` ✅ 27/27。

---

## 15. 零散用户可见品牌文案

| 位置                                           | 处置                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `desktop/src/main/index.ts` 退出确认弹窗       | `确认退出 Z Code?` / `Quit Z Code?` → `Polaris`     |
| `web/src/auth/webAuthLocale.ts` Web 登录页文案 | `使用……Z.AI 账号身份` / `用 Z.AI 登录` → 去 Z.AI 化 |

均为纯展示文案，不涉及任何能力。验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors。

---

## 16. 插件市场：多源 + 三级降级（结论：保留框架，不砍）

**先说结论**：插件市场**不是被本轮砍掉的**，市场框架、商店 UI、安装/启用/缓存业务逻辑全部保留。

- 市场格式是**公开标准**（Claude Code 的 `.claude-plugin/marketplace.json`；插件包识别
  `.zcode-plugin/` / `.claude-plugin/` / `.codex-plugin/` 三种 manifest）。数据源不独属任何厂商。
- 此前唯一的默认源被（本线程之前的基线提交 `f3f5d4b`）指向 `polaris.bitlesu.com/plugins/marketplace.json`，
  该后端尚未部署 → 刷新失败、列表空。**这是源地址问题，不是能力被删**。
- **内置插件是本地 seed**（SEA 资源 + `<storage>/cache/zcode-plugins-official/…`），离线始终可用，不受市场源可达性影响。
  ⚠️ 本仓库能真正 seed 的只有 **2 个**（`node-repl-host` / `browser-use`），其余定义指向的插件包
  目录在本仓库中不存在 —— 详见 §17a.2。

本轮按「只砍必要、能复用就留」的原则做的改动是**增强而非砍除**：

1. **源可选 / 源可添加**：新增公开预置源清单（6 个，实测全部可添加），一键添加；默认安装不向第三方发请求。
2. **三级降级**：`remote → snapshot → bundled`。刷新失败但本地有上次成功目录时降级为 warning
   （UI 显示「离线目录」），不再裸报 `fetch error`；只有「失败且无目录」才是 error。
3. **官方目录镜像 + 可调优先级**：`zcode-plugins-official`（与 Z.ai 原站同名，无法当普通源添加）以
   镜像形式支持多来源——默认 `[Polaris 自有, Z.ai 原站]`，按优先级逐个尝试，失败自动降级；
   顺序可用 `POLARIS_PLUGIN_MARKETPLACE_MIRRORS` 手动覆盖。实测主源不可达后回退 Z.ai 成功（26 个插件）。
4. **外部工具接入点**：`POLARIS_PLUGIN_MARKETPLACE_SOURCES` 环境变量 + 预置源注册表。

完整设计/运维/接入说明见 `POLARIS-PLUGIN-MARKETPLACE.md`。

验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors；CLI `turbo run typecheck` ✅ 27/27；
新增测试 ✅（`packages/shared/test/pluginMarketplaces.test.ts`、
`apps/zcode-cli/packages/bootstrap/test/marketplaceDegradation.test.ts`）。

---

## 17. 复盘：市场第二批（物化策略 + UI 修形）

本节的目的是让你能**独立复核**，所以每个结论都带可复现的证据命令。

### 17a. 四个问题的核查结论

#### 17a.1 「dev 为什么还要构建？」

因为 dev 跑的**不是源码**，是把 agent 打包成单文件再交给 Electron：

```
scripts/dev-desktop-env.mjs
  run(pnpm --filter @zcode/desktop pre-dev)
  run(node scripts/build-desktop-agent-cli.mjs)   ← 编译 adapters/bootstrap 并 stage 成 zcode.cjs
  run(pnpm --filter @zcode/desktop dev:runtime)   ← 再起 Electron
```

证据（跑着的 agent 用的是磁盘上那份 `zcode.cjs`）：

```bash
ls -la packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs   # 构建时间
```

结论：**你不需要手动敲构建命令** —— `pnpm run dev:desktop` 开头自带打包；但**只关掉窗口再打开不够**，
bundle 文件没变，跑的还是旧代码。纯 UI（渲染层）改动走 Vite 热更新，不需要重启。

#### 17a.2 「那 27/39 个插件是本地自带的吗？你怎么砍的？」

**一个插件都没砍。** 数字拆解（两边都是磁盘实证）：

| 组成                        | 上游装机（`~/.zcode/cli/plugins`） | 本 fork（`~/.polaris/cli/plugins`） |
| --------------------------- | ---------------------------------- | ----------------------------------- |
| 远端目录（Z.ai CDN，26 条） | 26                                 | 26                                  |
| 本地 seed（内置插件包）     | 14                                 | **2**                               |
| 合计                        | **40**                             | **28**                              |

为什么本地 seed 少 12 个：`official-plugin-definitions.ts` 里每个定义都有 `rootCandidates`，
只有能在磁盘上找到 `.zcode-plugin/plugin.json` 的插件才会进入目录。本仓库里：

```bash
find . -name ".zcode-plugin" -not -path "*/node_modules/*"
# → apps/zcode-cli/packages/browser-use-plugin/.zcode-plugin
# → apps/zcode-cli/packages/node-repl-host/.zcode-plugin      （只有这两个）
```

缺的定义指向 `packages/android-emulator-plugin`、`packages/image-search-plugin`、
`packages/ios-simulator-plugin`、`packages/restore-legacy-sessions-plugin`、
`packages/plugin-creator-plugin`、`packages/skill-creator-plugin`、`packages/zcode-guide-plugin`、
`packages/zcode-cua-plugin` —— **这些目录在开源仓库里根本不存在**（上游分发版才带）。
本仓库也没有 `documents` / `pdf` / `presentations` / `spreadsheets` 的定义。

能不能从 CDN 补回来？**不能**，全为 404（实测）：

```bash
curl -sI https://cdn-zcode.z.ai/zcode/official-plugin/plugins/pdf/0.1.7/plugin.zip          # 404
curl -sI https://cdn-zcode.z.ai/zcode/official-plugin/plugins/image-search/0.1.1/plugin.zip # 404
# … 共 12 个，全部 404
```

可选项（需你拍板，见 §17f）：从你自己那份上游安装里取包（`~/.zcode/cli/plugins/cache/zcode-plugins-official/` 下
确实有 `pdf` / `documents` / `presentations` / `spreadsheets` / `image-search` / `skill-creator` / …）
放回仓库对应目录 —— 但那是 Z.ai 的插件内容，**再分发**要看它们的许可，不是 Apache-2.0 自动覆盖的东西。

#### 17a.3 「添加插件源为什么那么久？是不是把插件全拉到本地了？」

**是，而且是两件蠢事叠加**（上游实现）：① 为了读一个 JSON 先 `git clone` 整个仓库；
② 再把整棵树复制进插件目录。已改为「读清单只发一个请求、装插件时才按需取」：

```
ADD  anthropics/claude-plugins-official (314)   472ms   磁盘 184K
ADD  alirezarezvani/claude-skills (99)          253ms   磁盘  92K
ADD  xiaolai/claude-plugin-marketplace (19)     265ms   磁盘  19K
INSTALL 相对路径条目                            4053ms  （sparse checkout 只取该目录）
```

对照旧数据：同样两个目录在盘上分别是 15M、60M。
**旧款整树会自动回收**：下次刷新该源时 `activateDirectoryAtomically` 整目录重建，实测 60M → 96K。

#### 17a.4 「那个添加弹窗的布局是什么垃圾？」

已复现并定位，且**修在组件层**。根因：`DialogContent` 是单列 grid，列是 `auto` 轨道；
推荐源列表的 `truncate`（`nowrap`）把轨道顶宽后，**同层所有直接子元素**（标题、输入框、页脚按钮）
一起被画到面板外面。隔离 harness 实测（同一份内层标记，只改外壳 class）：

```
修复前：面板右边界 477，输入框/页脚右边界 574 ✗，溢出的直接子元素 4 个（title/section/field/footer）
修复后：面板右边界 995，输入框/页脚右边界 978 ✓，溢出的直接子元素 0 个
```

修复：`components/ui/dialog.tsx` 加 `grid-cols-[minmax(0,1fr)]` + `[&>*]:min-w-0`，
从组件层消除这一类问题，不再依赖每个调用方自觉加 `min-w-0`；
调用方（含既有 128 处 `DialogContent`）用 `cn()`/`tailwind-merge` 传自己的 `grid-cols-*` 仍可覆盖。

### 17b. 本轮改动文件清单

| 文件                                                                     | 一句话                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts`            | 只读清单（删掉整树复制路径）；github 免 clone 取清单；安装按需 sparse 物化；旧整树自动回收 |
| `apps/zcode-cli/packages/adapters/test/marketplaceStagingWeight.test.ts` | 新增 3 条守护测试（只落清单 / 按需物化 / 回收旧树）                                        |
| `packages/ui/src/components/ui/dialog.tsx`                               | 组件层修形（§17a.4）                                                                       |
| `packages/ui/src/settings/AddMarketplaceSourceDialog.tsx`                | 推荐源区块加 `min-w-0` / `overflow-x-hidden` / `shrink-0` 第二道保险                       |
| `POLARIS-PLUGIN-MARKETPLACE.md`                                          | §4.4 改写为最终物化语义 + 实测数据；新增 §4.5.1 对话框溢出复盘；§10.1 变更记录             |

### 17c. 我引入过、并已修掉的问题（不藏）

1. **构建一度是坏的**：上一轮我把 `stageMarketplaceDirectoryPlugins` 的定义删掉后，`loadMarketplaceFromSource`
   里还有 3 处调用没跟上（`tsc` 会直接报未定义）。本轮把调用点一并清掉并去掉了 `persist` 参数，
   现在 `turbo run typecheck` 27/27。
2. **品牌泄漏**（上一轮引入，已修）：Z.ai 镜像 manifest 的 `owner: {name: "Z.ai"}` 与厂商描述
   会被合并写进本地状态。现在镜像只能贡献插件条目 / `featured`，身份字段一律本地决定；
   实测 `~/.polaris/.../marketplace.json` 为 `owner=null` + Polaris 描述。
   守护测试：`apps/zcode-cli/packages/adapters/test/officialMarketplaceBranding.test.ts`。
3. **弹窗溢出**（本轮引入，已修）：见 §17a.4。
4. **降级漏了一处**（上一轮引入，已修）：`getZCodePluginsOverview` 里还有一份「刷新失败即 error」
   的旧逻辑，只修 `updateZCodePluginMarketplace` 不够，红条仍会出现。两处现在收敛到同一个 helper。

### 17d. 没有改、没有删的东西（对照用）

- 商店页面结构与导航（`PluginStorePage` 只多传两个 props）、安装/启用/卸载/更新/恢复内置的全部业务逻辑。
- 源类型全集：`url | github | git | git-subdir | npm | file | directory` + zip 源（含 sha256）。
- `describeMarketplacePlugin`（详情页）、依赖闭包解析、`allowCrossMarketplaceDependenciesOn`。
- 官方目录的保留 id 守卫（同名镜像只能作镜像，不能当普通源添加）。
- Node Repl Host 的可见性（你确认保留现状，未动）。

### 17e. 存储与残留

| 目录                     | 大小 | 归属                                                                         | 处置                                                                                     |
| ------------------------ | ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `~/.polaris/cli/plugins` | 2.7M | **本 fork 在用**                                                             | 已无整树，`marketplaces/*` 合计 384K                                                     |
| `~/.zcode`               | 11G  | 上游 ZCode 的旧数据根（本 fork 不做迁移，`DATA_ROOT_DIR_NAME = ".polaris"`） | 未动；要清理用 `rm -rf ~/.zcode`（会一并删掉旧版已装插件与工作区，不可逆，故留给你决定） |
| `~/.openclaude`          | 7.5M | 6 月的无关残留                                                               | 未动                                                                                     |

### 17f. 待你拍板的开放项

1. 缺的 12 个内置插件：接受现状（28 条）／从你自己的上游安装里把插件包取回仓库对应目录（许可需确认）。
2. `~/.zcode` 11G 是否清理。
3. Node Repl Host 是否在公开列表隐藏（现状保留）。

### 17g. 验证

```
pnpm typecheck                     ✅ 0 错误
CLI turbo run typecheck            ✅ 27/27
pnpm lint                          ✅ 0 errors（80 warnings，全部是既有文件）
tsx --test（shared + bootstrap + adapters）  ✅ 16/16
真实源 ADD/INSTALL（临时 storage）  ✅ 见 §17a.3
```

---

## 18. 全量复核：有没有砍错、还有什么该砍（2026-09-27）

基准是 fork 自己的开源快照 **`872ad96` "feat: open source"**（不是 `77432b6`，那是个空 initial commit，
拿它做基准会算出「0 删除」的假结论——这点我自己先踩过一次）。

相对该基准的规模：**66 个文件被删，291 个顶层导出被删，53 个 zh-CN 文案键被删，34 005 行删除 / 18 034 行新增**。

### 18a. 你问的 computer-use：它从没在这个仓库里存在过

```bash
git log --all --oneline -- packages/zcode-cua-plugin      # 空 → 本仓历史中从未存在
find . -name ".zcode-plugin" -not -path "*/node_modules/*"
# → 只有 browser-use-plugin、node-repl-host
git log --oneline -S "电脑控制回退为默认关闭"                 # → 872ad96（开源快照本身，不是我们砍的）
```

`official-plugin-definitions.ts` 里 computer-use 的候选路径是 `packages/zcode-cua-plugin`、
`../zcode-cua-plugin` …，而这些目录在本仓不存在（它们在**上游闭源 monorepo** 里；
`packages/desktop/scripts/koffi-package-assets.mjs:71` 就有 `pluginRelativePath = "packages/zcode-cua-plugin"`，
说明构建脚本预期一个本仓没有的包）。CDN 也没有它的 zip（`plugins/computer-use/0.6.3/plugin.zip` → 404）。

两个附带事实：

1. **默认关闭是上游产品决策**（baseline 自带）：定义里没标 `defaultEnabled`，
   `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 也刻意不含它，注释写明「computer-use 携带 MCP server 与系统 Helper
   依赖，默认开启意味着每个新用户首启即注入整套工具集」。
2. **能力脚手架在仓里，插件包不在**：`packages/zcode-cua`（runtime）、`cua-permission-broker`、
   `ComputerUseSection`（设置页入口，`SettingsPage.tsx:1924` 挂载）都在，缺的只有那个插件包。
   所以你会在设置里看到一个「电脑控制」段，但插件市场里找不到 computer-use —— 这是**内容缺失**，不是被砍。

要恢复只能把 `zcode-cua-plugin` 包内容放回仓库（你自己那份上游安装
`~/.zcode/cli/plugins/cache/zcode-plugins-official/computer-use/0.6.3` 里确实有）；
那是 Z.ai 的插件内容，再分发要看它的许可。

### 18b. 「砍错」检查（悬空引用扫描）——结论：没有发现被砍错的能力

方法：把基准以来的删除物分四类，逐个回查仓内是否仍有引用。

| 检查项                                  | 结果                                                                                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 被删的 53 个文案键是否仍被代码引用      | **0 个悬空**（32 个仍被引用，但它们的键在 zh/en 两侧都还在，删掉的只是同一个键的重复行）                                                                                                                                                                        |
| 被删的 66 个文件的模块名是否仍被 import | **0 个真实悬空**（命中项全是**注释**里的历史说明，如 `oauthUnauthorizedRequest.ts:23`、`officialMcpCredentials.ts:39`）；`coding-plan-subscription/` 目录只删了 provider 实现，被 import 的 `codingPlanSubscription*.js` 都还在                                 |
| 被删的 8 个支付图标是否仍被引用         | **0 个引用**（纯资源，删对了）                                                                                                                                                                                                                                  |
| 仍指向官方域名的出网路径                | 只剩三类命中，**均为有意保留**：① 旧配置里官方域名→自有网关的**匹配键**（`legacyZCodeConfigProviderReader.ts:66`，永不直接请求）；② 历史注释；③ 插件市场镜像（本线程新增，可用环境变量关掉）。`zcodeEndpoint.ts` 四个默认 origin 均已指向 `polaris.bitlesu.com` |

也就是说：能力层面**没发现砍错的东西**。

### 18c. 「应该继续砍」清单（按确定性排序）

1. **死模块 3 处**（导出在自身文件之外 0 引用）：
   - `packages/services/src/bigmodel/codingPlanEntitlement.ts`（`fetchPersonalCodingPlanEntitlement` /
     `fetchTeamCodingPlanEntitlement` / `isActivePersonalCodingPlan` 均 0 外部引用）
   - `packages/services/src/bigmodel/teamPlanApiKey.ts`（只被上面那个文件 import）
   - `packages/services/src/providers/zaiBusinessTokenResolver.ts`（`ZaiBusinessTokenResolver` 仅自引用）
     合起来 ~5.5K 行附近的官方业务残留，是整个 `bigmodel/` 目录与 `providers/` 里最后一小块。
2. **陈旧元数据**：`third-party/inventory.json` 仍列着已删除的
   `patches/@arms__rum-electron@0.0.3.patch` 与 `@arms/rum-electron@0.0.3`（4 处）；
   依赖与补丁文件都已不在（`patches/` 下只剩两个 ai-sdk 补丁）。
3. **删掉的官方登录文案键 17 个**：`login.oauth.*`（整个簇）、`login.expired.*`、`welcome.login(.Failed)`；
   `login.oauth.` 前缀在代码中作为前缀出现 **0 次**，是纯死键。
4. **死文案键（保守估计 1 035 个，占 18.5%）**：方法学警告——`zh-CN.ts` 共 5 598 键，
   字面无引用的 2 193 个；排除模板拼接（`occupationOnboarding.${key}` 这类共 237 处）后剩 1 035 个。
   这个数字只能当**候选**看（一键一改前建议逐簇抽验，`chat` 410、`feedback` 182、`git` 46 是大头）。
5. **数据残留**：`~/.zcode` 11G（上游旧数据根，Polaris 不读）。
6. **待你定性的展示项**：Node Repl Host 在公开列表可见（上游一直如此）；
   `CodingPlanUsageRemainingPanel` / `BigModelRegistrationHint` / `startPlan.*` 一族
   仍指向已不可达的官方业务（见 §12 的保留/清除边界决策）。

### 18d. 本次复核的局限（别把它当全覆盖）

- 悬空引用靠**字符串级**扫描，能抓住死键/死模块/死资源，但抓不住「运行时才走到」的问题。
- 布局类（如 §17a.4 的弹窗溢出）无法用静态检查定性，必须逐页真机 DOM 验证。
- 截图里的 39/28 差异已在 §17a.2 用磁盘数据拆解清楚，不涉及任何删除。

---

## 19. 模型身份（Identity）去品牌

有人在机器上扫过「模型为何自称 ZCode」，结论方向对、**归属错**：

- 那份报告读的是 `E:\ZCode\resources\glm\zcode.cjs` —— **上游装机**，不是本 fork。
- 本 fork 的身份源在**源码**：`apps/zcode-cli/packages/core/src/context/sections/{cli-prefix,identity}.ts`，
  构建后落到 `packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs`（dev）/
  `apps/zcode-cli/packages/cli/dist/zcode.cjs`。
- 所以报告里「想改身份只能编辑 cjs」**不成立**：改源码 + `pnpm run dev:desktop`（会自动重新打包）即可。
- 报告里另一个正硬结论保留：`.polaris\` 里没有身份定义，那里只有运行时数据。

### 19a. 本次改掉的 13 处（全部是字符串字面量，无逻辑，仓库内无任何代码/测试解析它们）

| 类别                       | 位置                                                                                                                                                                                                                                                  | 原 → 新                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份前缀（模型自称的源头） | `context/sections/cli-prefix.ts`                                                                                                                                                                                                                      | You are ZCode… → **You are Polaris, an interactive coding agent**                                                                                        |
| 身份段（同上）             | `context/sections/identity.ts`                                                                                                                                                                                                                        | ZCode's tools… / You are an interactive ZCode agent… → **Polaris**                                                                                       |
| 段名/标题                  | `context/sections/desktop.ts`                                                                                                                                                                                                                         | ZCode Desktop Context → **Polaris Desktop Context**                                                                                                      |
| 子代理身份                 | `subagent/explore.ts`、`subagent/general-purpose.ts`                                                                                                                                                                                                  | ZCode Explore / agent for ZCode CLI → **Polaris**                                                                                                        |
| 连通性探测身份             | `runtime/methods/workspace-generate-text.ts`                                                                                                                                                                                                          | You are ZCode connectivity probe. → **Polaris**                                                                                                          |
| 注入给模型的文本           | `runtime/helpers/conversation.ts`、`session-context/references.ts`、`system-reminder/incoming-message.ts`、`tool/handlers/read-session-context.ts`、`tool/handlers/read.ts`、`runtime/helpers/attachment-path-reference.ts`、`tool/handlers/agent.ts` | 界面/工具描述里的 ZCode → **Polaris**                                                                                                                    |
| 出网 UA / 标题             | `tool/handlers/webfetch-constants.ts`、`plugins/github-archive-source.ts`、`browser/descriptor.ts`、`shared/zcode-source-headers.ts`、`shared/openrouter-attribution.ts`                                                                              | ZCode-WebFetch（原指向 zcode.ai）/ ZCode-Plugin-Installer / ZCode Headless Chromium / ZCode-unknown / Z Code@electron / X-OpenRouter-Title → **Polaris** |

### 19b. 有意**不改**的（每一类都有理由）

| 项                                                                            | 理由                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `@zcode/*` 包名、`ZCODE_*` 环境变量、文件名、`zcode-agent` 这类**内部标识符** | 沿用历轮约定：改它们会改变磁盘/配置/协议形状，不是用户可见品牌 |
| `X-ZCode-App-Version` 的**头名**                                              | 与后端/网关的契约字段，改名前必须同步服务端（本次只改了值）    |
| 启动计时标记、错误类名（如 `ZCodeCliLoginError`）、debug 日志                 | 用户不可见，改了只是噪声                                       |
| `ZCODE_AGENT_PROVIDER_LABEL = "ZCode Agent"`                                  | 已经是**死常量**（全仓 0 引用），改或删都不影响行为            |
| `.agents/skills/**` 里的 ZCode 文案                                           | 开发期 agent 技能文档，不进产品提示词                          |
| `zcode-guide` 定义的 `displayName: "ZCode Guide"` 等 listing                  | 该插件包本仓不存在，装了上游包才能在商店里看到                 |

### 19c. 生效方式与验证

```
node scripts/build-desktop-agent-cli.mjs   → bundle 重建 02:47
bundle 内：You are Polaris… / Polaris Explore / agent for Polaris CLI / Polaris connectivity probe
           / Polaris Headless Chromium / Polaris-WebFetch / Polaris-Plugin-Installer  全部 → 1
bundle 内：You are ZCode… / ZCode Explore / agent for ZCode CLI / ZCode connectivity probe  全部 → 0
pnpm typecheck ✅ 0 错误 · CLI turbo run typecheck ✅ 27/27 · tsx --test ✅ 16/16
```

注意：**已经在跑的 agent 进程仍持有旧 bundle**，重启应用（或新开会话）后身份才变。

---

## 20. 产品化第三轮：深链 scheme、shell 集成、进程名、空壳能力盘点

扫了四个面：① 应用元数据/深链；② 操作系统集成（Win 右键菜单 / macOS Finder 服务 / Linux xdg）；
③ 外部可见标识（进程名、UA）；④ 历轮被空壳化的**公用能力**（你关心的“不该砍的”）。

### 20a. 已经是对的（不需改）

| 项                               | 现状                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 安装包身份                       | `productName: Polaris`、`appId: com.bitlesu.polaris`、Linux executable `polaris`、homepage/maintainer 均为 `polaris.bitlesu.com` |
| 主进程身份                       | `app.setName()` / `process.title` = 运行时产品名（Polaris）                                                                      |
| 右键菜单/Finder 服务的**展示名** | 已是「在 Polaris 中打开 / Open in Polaris」                                                                                      |
| 端点默认值                       | `zcodeEndpoint.ts` 四个默认 origin 全部 `polaris.bitlesu.com`                                                                    |
| 更新源                           | `publish.url` 仍是 `http://localhost:8081` 占位（有意）                                                                          |

### 20b. 本轮改掉的（全部带旧值清理，不会产生重复菜单/孤儿文件）

| 项                 | 位置                                                                                                                           | 改法                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 深链 scheme        | `desktopDeepLinkUrl.ts` 解析层、`web/share/conversationSharePreviewClient.ts` 发送层、`electron-builder.config.js` `protocols` | 对外发布 `polaris://`；**解析层两 scheme 都收**；注册层两个都注册（polaris 优先声明）。旧分享链接继续可用                                                                                                  |
| macOS Finder 服务  | `desktopFinderOpenFolderWorkflow.ts`                                                                                           | `Open in Polaris.workflow` + bundle id `app.polaris.finder-open-workflow` + 脚本改用 `polaris://`；按 legacy bundle id 确认归属后删掉旧的 `Open in ZCode.workflow`                                         |
| Windows 右键菜单   | `desktopWindowsOpenFolderContextMenu.ts`                                                                                       | 注册表键 `Polaris.OpenInPolaris`；新键写成功后删除 `ZCode.OpenInZCode`（Directory/Drive 两处）                                                                                                             |
| Linux 协议处理器   | `desktopLinuxDeepLinkRegistration.ts`                                                                                          | `polaris.desktop` + `x-scheme-handler/polaris`；MimeType 同时声明旧 scheme；归属标记两个都认（新 `Comment=Polaris Desktop App` + 旧 `Comment=ZCode Desktop App`）；旧 `zcode.desktop` 被识别为自己的就清理 |
| 进程名             | `shared/src/process-names.ts`                                                                                                  | 前缀 `zcode` → `polaris`（任务管理器里从 `zcode-*` 变 `polaris-*`）；全部消费者走同一 formatter，资源管理器进程列表自动跟随                                                                                |
| 开发态更新缓存目录 | `packages/desktop/dev-app-update.yml`                                                                                          | `zcode-dev-updater` → `polaris-dev-updater`（仅目录名）                                                                                                                                                    |
| 文案               | `shared/src/platform.ts` 注释                                                                                                  | `zcode://` → `polaris://`                                                                                                                                                                                  |

验证：desktop 构建产物（dev watch 已重建）`polaris-*` 命中 19 处、`zcode-renderer|zcode-host-|zcode-main` 命中 **0**。

### 20c. 有意保留的（契约 / 格式 / 生态兼容）

| 项                                                                                | 为什么不改                                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.zcode-plugin/` 插件清单目录、`.zcodeignore`                                     | 第三方插件包与公开生态按这个名字声明；改名等于与整个插件生态脱钩。若要自有品牌，应做**双支持**（`.polaris-plugin/` 优先、`.zcode-plugin/` 兼容）——需要单独设计 |
| `~/.zcode/server`（远程会话路径）                                                 | 远端机器上的契约路径，改名前必须同步远端 agent                                                                                                                 |
| `X-ZCode-App-Version` 头名                                                        | 与自有网关的契约字段（值已改）；改名要前后端同时发                                                                                                             |
| `@zcode/*` 包名、`ZCODE_*` 环境变量、`zcode-agent` 之类内部标识                   | 历轮约定的“内部标识不改”                                                                                                                                       |
| `mcpUserDirectory/legacy.ts` 里的 `join(appData, "ZCode", ...)`                   | 这是**读旧版数据做迁移**用的，改了反而丢用户数据                                                                                                               |
| 模型供应商名 `Z.ai` / `BigModel`（locale 与 web 分享页）                          | 它们是**真实的第三方 provider**（用户可选接入），不是本产品身份                                                                                                |
| Linux 图标名 `Icon=zcode`                                                         | 与打包写入的图标文件名成对；改了若不同步会出现“齿轮”图标（需打包侧一起改）                                                                                     |
| `zcodeProductFlavor` / `.zcode-install-manifest` / `zcode-window-bounds` 等资源名 | 仅内部产物名，用户不可见                                                                                                                                       |

### 20d. 空壳能力盘点（“不该砍的”答复）

你担心的“公用功能被砍”逐项核过：**接口都还在，只是实现变空壳 + 写明重接点**，调用方无需改。

| 能力                                                        | 现状                                                                                                                                                         | 重接方式                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 账号请求鉴权                                                | `model-provider/accountRequestAuthService.ts`：读返回 `null`，写抛 `AccountRequestCredentialUnavailableError`（等价于“没连账号”的旧行为）                    | 实现 `IAccountRequestAuthService` / 接回 `AccountRequestAuthResolver`，调用点不动 |
| OAuth 服务                                                  | `oauth/oauthService.ts`、`oauthProviderLogout.ts` 空壳；凭证仓库 `oauth/repo` 保留                                                                           | 自有 provider 接回即可                                                            |
| 会话分享                                                    | **未砍**：真实 `ConversationShareService` 在用，`createUnsupportedConversationShareService` 只用于 remote workspace（上游原有行为）；分享站点指向自有 origin | —                                                                                 |
| 插件市场 / 技能 / 子代理 / 工作流 / 浏览器 / 电脑控制脚手架 | 全部保留                                                                                                                                                     | —                                                                                 |

### 20e. 本轮验证

```
pnpm typecheck            ✅ 0 错误
pnpm lint                 ✅ 0 errors（80 warnings，均为既有文件）
tsx --test（9 个文件）    ✅ 26/27
  ✖ packages/ui/test/nonCliAcpRetirement.test.ts —— 预先存在的跑法限制：
    它 import 的 ToolCallBlocks/renderers/agentHelpers.ts 用 `@/lib/*`，而 `@/*` 只定义在
    packages/ui/tsconfig.json；用仓库根的 tsx 跑就解析不到（与本轮改动无关，未改动这两个文件）
```

### 20f. 还没动的（等决策）

1. `.zcode-plugin/` → 是否做 `.polaris-plugin/` 双支持（生态兼容 vs 自有品牌）。
2. Coding Plan / Start Plan 一族 UI（`settings.modelProvider.startPlan.*`、`CodingPlanUsageRemainingPanel`、`BigModelRegistrationHint`）仍指向已不可达的官方业务。
3. §18 的死模块/死文案键/陈旧 third-party 清单。
4. `~/.zcode` 11G 旧数据目录。
5. Node Repl Host 在公开列表的可见性。

---

## 21. 第八刀：死模块 + 死文案键 + 陈旧 third-party 清单（2026-09-27）

先做「核心功能有没有被破坏」复核，再执行 §18c 中确定性最高的三项。

### 21a. 核复（核心功能未破坏）

- 对基准 `872ad96` 起被删的 **66 个文件**逐个回查 import：**0 个真实悬空**（“index”命中全是同名文件误报）。
- `pnpm typecheck` ✅ 0 错误；`apps/zcode-cli` `turbo run typecheck` ✅ 27/27。
- 插件市场测试全绿：`shared/pluginMarketplaces`(8)、`adapters/officialMarketplaceBranding`(2)、
  `adapters/marketplaceStagingWeight`(2)、`bootstrap/marketplaceDegradation`(4)。
- 结论：**能力层面没有发现被破坏的核心功能**。

### 21b. 本轮砍掉的

| 项                      | 内容                                                                                                                                                                      | 依据                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 死模块 3 个             | `packages/services/src/bigmodel/codingPlanEntitlement.ts`、`.../bigmodel/teamPlanApiKey.ts`、`.../providers/zaiBusinessTokenResolver.ts`（`bigmodel/` 目录随之消失）      | 顶层导出在全仓 0 外部引用（`teamPlanApiKey` 仅被 `codingPlanEntitlement` 引用，后者又 0 引用）；无测试引用 |
| 死文案键 17 个          | `login.oauth.*`(12)、`login.expired.title                                                                                                                                 | description                                                                                                | restart`(3)、`welcome.login`、`welcome.loginFailed` | `login.oauth.` 前缀在代码中 0 次；`login.expired.action` **被 `StatusCards.tsx:504` 使用而保留** |
| 陈旧 third-party 元数据 | `third-party/inventory.json` 里 `@arms/rum-*` 全部（hashes 映射 1 处、`patches` 1 条、`packages` 3 条、`exceptions` 3 条）+ 3 个孤儿证据文件 `third-party/upstream/*.txt` | `@arms/rum-{browser,core,electron}` 在 `pnpm-lock.yaml` 中已 **0 引用**（整族随遥测改写层移除）            |

### 21c. 本轮验证

```
pnpm typecheck                         ✅ 0 错误
JSON.parse(third-party/inventory.json)  ✅ OK
删除模块的外部引用扫描                    ✅ 0 悬空（含测试）
```

注：`node scripts/licenses.mjs notices` 在本机 Windows 上因 `pnpm -r ls` 触发 `EMFILE`（文件句柄上限）
无法重生成 inventory，故本轮为**手工定点删除**陈旧条目并保留 JSON 结构；后续在有足够句柄的机器上应重跑
`notices` + `check` 以恢复生成式一致性。

### 21e. 第八刀续：官方购买 funnel 与 BigModel 品牌提示（用户决策：能复用的留、不能复用的砍）

先理清「哪些可复用」再动手：

- **seam 层（保留）**：`ICodingPlanSubscriptionService`、`IUsageStatsService`、`CodingPlanUpgradeDialogProvider` /
  `useCodingPlanUpgradeDialog`（购买入口的上下文与状态机）、通用用量/额度展示。将来接自有套餐只需实现接口。
- **不可复用、已砍**：

| 文件                                                           | 内容                                          | 为什么不可复用                                |
| -------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `settings/model-provider-section/BigModelRegistrationHint.tsx` | BigModel 未注册提示 + 官方注册跳转            | 绑死 BigModel 品牌与官方注册页                |
| `settings/CodingPlanEmbeddedWebviewDialog.tsx`                 | 打开 Z.ai 官网 `/coding-plan` 的内嵌 webview  | 打开官方站点、注入官方 OAuth 凭据             |
| `settings/model-provider-section/codingPlanEmbeddedWebview.ts` | 官网 URL 构造 + 凭据注入脚本 + 官方上报上下文 | 写死 `oauth:zai:*` / `zcodeBridge` / 官网路径 |
| `settings/codingPlanUpgradeLoginRecovery.ts`                   | 官方 OAuth 登录后重开购买弹窗                 | 依赖官方 OAuth 登录编排                       |
| `settings/model-provider-section/codingPlanPurchaseAuth.ts`    | 官方购买鉴权判定                              | 仅服务官方 webview，0 其余引用                |

处置：`CodingPlanUpgradeDialog.tsx` 改写为**无界面 seam**（保留 `CodingPlanUpgradeDialogTarget` 类型与
组件签名，`useEffect` 里回报 `onOpenResult(false)`，不打开任何官方界面）；Provider 与所有入口调用方零改动。
同步删除 5 个 webview 文案键 `settings.modelProvider.codingPlan.webview.*`（0 引用）与 2 个 BigModel 注册文案键。

### 21f. 仍未动（等决策 / 下一刀）

- **官方漏斗埋点** `lib/codingPlanFunnelTelemetry.ts`（写死 `Z_AI`/`MaaS` channel + 官方 provider id，
  被 AutomationsSection / Provider / Detail / StatusCards / SessionPane 5 处接线）：属官方分析，但是纯上报、
  非用户可见功能，删它要动 5 个文件，建议下一刀单独做。
- **官方企业/团队定价与 Start Plan**：`enterpriseCodingPlanProducts` / `useEnterpriseCodingPlanProducts` /
  `codingPlanEnterpriseTiers` / `useStartPlanPreview` / `StartPlanBalanceCard` / `StartPlanQuotaStatusCard`——
  这些是「可改造复用的 UI 骨架 + 官方数据源」，删与留取决于自有套餐的数据形状，建议接自有套餐时一并定。
- **`CodingPlanUpgradeDialog` 的复查**：现在点升级会立即回报「未打开」；自有购买界面接回后即可恢复。
- `.zcode-plugin/` 双支持、`~/.zcode` 11G、Node Repl Host 可见性。

### 21g. 复验

```
pnpm typecheck   ✅ 0 错误
pnpm lint        ✅ 0 errors（80 warnings，回到本轮前基线，未新增）
```

### 21h. 第八刀再续：官方购买漏斗埋点（2026-09-27）

删除了 `packages/ui/src/lib/codingPlanFunnelTelemetry.ts`——它把点击事件按官方漏斗 schema
（`coding_plan_upgrade_ck`）上报，写死 `channel: Z_AI / MaaS` 与官方 provider id，自有套餐必然重写。

连带把 `CodingPlanUpgradeDialogTarget.funnelContext` 及全部构造点清掉（共 6 个文件）：

| 文件                                              | 改动                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `settings/CodingPlanUpgradeDialogProvider.tsx`    | 移除 `usePlatform` / `reportCodingPlanUpgradeClick` 与 funnel 合并块           |
| `settings/model-provider-section/StatusCards.tsx` | 移除 `createSettingPlanCardFunnelContext` 与 `openUpgradePlans` 的 funnel 参数 |
| `settings/model-provider-section/Detail.tsx`      | 移除 `nextFunnelContext` 与两处 `funnelContext: options.funnelContext`         |
| `v4/SessionPane.tsx`                              | 移除闲时/额度横幅入口的 funnel 构造                                            |
| `settings/AutomationsSection.tsx`                 | 移除闲时入口的 funnel 构造                                                     |
| `settings/CodingPlanUpgradeDialog.tsx`            | target 类型去掉 `funnelContext`                                                |

「可复用」边界不变：`openCodingPlanUpgrade` 入口 API、`inventory` 门禁、弹窗 seam 均保留。

验证：`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors（80 warnings，未新增）。

### 21i. 仍未动（等决策）

- **官方企业/团队定价与 Start Plan**：`enterpriseCodingPlanProducts` / `useEnterpriseCodingPlanProducts` /
  `codingPlanEnterpriseTiers` / `useStartPlanPreview` / `StartPlanBalanceCard` / `StartPlanQuotaStatusCard`——
  「可改造复用的 UI 骨架 + 官方数据源」，删与留取决于自有套餐的数据形状，建议接自有套餐时一并定。
- **官方套餐 i18n 候选**：`settings.modelProvider.codingPlan.*` 下按字面引用扫出 ~370 个未命中键，
  但**不可据此删除**——购买面板大量用模板/变量拼 id，静态扫描会误报（同 §18d 的方法学警告）。
- `.zcode-plugin/` 双支持、`~/.zcode` 11G、Node Repl Host 可见性。

---

## 22. 第九刀：官方 OAuth 漏网残留 + 无人调用的下单/支付 seam（2026-09-27）

用户决策「骨架留、官方数据源砍」后，先做**穷举式引用核对**再动手（上一轮曾把 Start Plan 骨架
误列入可砍，本节是纠正后的结论）。

### 22a. 砍之前先纠正一个误判

Start Plan / 企业套餐 7 个文件**不是死代码，不该砍**。只匹配 `import ... from` 语句的精确统计：

| 文件                                               | 活跃 importer                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useEnterpriseCodingPlanProducts`                  | **5**：SettingsPage、WorkspaceSidebarFooterUsageSummary、ModelProviderSection、Detail、V4ComposerToolbar                                                  |
| `enterpriseCodingPlanProducts`                     | **5**：codingPlanUsageSources、codingPlanEnterpriseTiers、providerFamilyConnectionVisibility、useEnterpriseCodingPlanProducts、useModelProviderNavigation |
| `codingPlanEnterpriseTiers`                        | 3：CodingPlanUpgradeDialog、Detail、StatusCards                                                                                                           |
| `StartPlanCard` / `StartPlanBalanceCard`           | 各 2                                                                                                                                                      |
| `useStartPlanPreview` / `StartPlanQuotaStatusCard` | 各 1                                                                                                                                                      |

**决定性的一点**：`resolveEnterpriseCodingPlanProductFamily` 被 `codingPlanUsageSources.ts` 与
`providerFamilyConnectionVisibility.ts` 调用，是**用量来源计算 + provider 连接可见性**的核心逻辑，
与购买 UI 无关。砍掉会直接破坏 provider 连接状态显示。

同时 4 个「数据源」方法有活跃 UI 调用方，**保留即等于「数据源已砍」**（它们返回空值）：

| 方法                    | 调用方                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `getStaticProducts`     | `useCodingPlanProducts:438`                                            |
| `getStaticTeamProducts` | `useEnterpriseCodingPlanProducts:143`                                  |
| `getStartPlanPreview`   | `useCodingPlanProducts:383`、`useStartPlanPreview:95`                  |
| `getEnterprisePricing`  | `useCodingPlanEntryPlanList:51`、`useEnterpriseCodingPlanProducts:146` |

### 22b. 官方数据源早已在 3af70d7 砍掉

`codingPlanSubscriptionService.ts` 是**完整空实现**：25+ 方法全部返回空值，**零网络请求**。
骨架文件内**零官方 URL/端点**，只剩 `bigmodel` / `zai` 这种 `ProviderFamilyDomain` 内部家族标识
（结构而非品牌，保留）。因此「骨架留、官方数据源砍」这条**在服务层已达成**，本轮不需也不应再动骨架。

### 22c. 本轮砍掉的（2 处，互不相干）

| #   | 目标                                                                          | 判定依据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **删除 `adapters/src/auth/bigmodel-oauth.ts`** + `auth/index.ts` 的 barrel 行 | 6 个导出符号全仓引用 **全部 0**（用正确符号名 `createBigmodelOAuthClient` / `createBigmodelOAuthState` / `BigmodelOAuth*` / `BIGMODEL_*` 复核）；barrel 下游只拿 `shared-credentials`；`from "@zcode/adapters"` 通配导入 5 处无一使用；动态调用 0、测试 0、package exports 0。内容是完整可用的官方 OAuth 客户端（`BIGMODEL_APP_ID = "zcode"`、`/login`、`/api/auth/tokenByAuthCode`），同目录 `cli-oauth` / `coding-plan-api-key` 早已改成抛错空壳，**唯它漏网**                                                                                                                         |
| 2   | **从 `ICodingPlanSubscriptionService` 与空实现同步删除 19 个下单/支付方法**   | `productInfo`、`preview`、`createSign`、`updateSign`、`checkPayment`、`checkPendingOrders`、`queryStripeCards`、`bindStripeCard`、`unbindStripeCard`、`payStripe`、`checkPaypalSupport`、`createPaypalSetupToken`、`subscribePaypal`、`getEnterpriseBalance`、`calculateEnterpriseOrder`、`createEnterpriseOrder`、`getEnterprisePendingOrders`、`cancelEnterpriseOrder`、`continueEnterpriseOrderPayment`、`checkEnterpriseOrderStatus` —— 逐个 `.方法(` 精确查 **20/20 = 0**；动态/字符串调用 0；测试 0；实现方仅空实现 1 个。顺带清理 `@zcode/shared` 中随之失效的类型导入（44 → 10） |

改动面：**4 个文件，-114 行 / +2 行**（1 删 3 改），不碰任何渲染逻辑。

### 22d. 差点砍错的两处（记下来，避免下次重犯）

1. **`batchPreview` 必须保留** —— `useCodingPlanProducts:228` 在用。上一轮把 20 个方法混列，
   `batchPreview` 是其中唯一的活调用。
2. **4 个数据源方法必须保留** —— 见 §22a 表格；删了就是连骨架一起砍，直接违反「骨架留」。

另：`packages/shared/src/coding-plan-subscription.ts` 里的官方支付类型（`CodingPlanPaypalSetupToken*` 等）
现在是**无消费方的导出类型**，不影响 typecheck/lint。属可后续清理的残留，本轮为控制风险未动。

### 22e. 验证

```
pnpm typecheck                                  ✅ 0 错误
apps/zcode-cli npx turbo run typecheck          ✅ 27/27
pnpm lint                                       ✅ 0 errors（80 warnings，与本轮前基线一致，未新增）
npx tsx --test（4 个插件测试文件）               ✅ 16 pass / 0 fail
coding-plan 相关测试                             0 个（不存在，故无测试破坏面）
已删符号残留引用扫描                              ✅ 0 悬空
```

---

## 7. 第二轮瘦身（2026-09-28 收尾）

### 7.1 已完成

| 批次             | 内容                                                                     | 收益                   |
| ---------------- | ------------------------------------------------------------------------ | ---------------------- |
| A 死重清理       | ai-elements 30 个零引用组件、devDeps 2 个、死资源 11 类                  | 渲染包 43.1MB → 28MB   |
| A shiki 去重     | 双版本（4.0.2 / 3.23.0）合并为单版本                                     | 语言 chunk 900+ 对合一 |
| B 官方品牌       | 内置插件 author/图标、CLI 上下文、webfetch UA、zcode-server-cli 管道名等 | —                      |
| B CLI 登录链     | 官方登录编排空壳化 + 选项 UI 下掉                                        | ~1,700 行              |
| C 官方套餐线     | 购买漏斗/配额链/智谱系内置模板/服务端 quota provider                     | ~4,000 行              |
| D preload 去重   | 值导入改走 shared 细粒度子路径                                           | **3.3MB → 533KB**      |
| D 生产 sourcemap | 默认不生成（`ZCODE_UPLOAD_MAPS=1` 可开）                                 | 渲染产物 139MB → 43MB  |
| D **端点闸门**   | 阻止 shell 里的官方端点变量烤进产物                                      | 见 7.2                 |

### 7.2 新发现的真问题：构建环境把官方端点烤进产物

`loadEnvFiles()` 会合并**整个 process.env**，而 `pickProductEndpointEnv()` 恰好挑
`ZCODE_BASE_URL` / `ZAI_OAUTH_ORIGIN` / `ZAI_BUSINESS_BASE_URL` / `ZAI_OAUTH_CLIENT_ID`。
只要构建在一个带这些变量的 shell 里跑（例如从 ZCode 宿主派生的终端），产物的
`__ZCODE_ENDPOINT_ENV__` 就是 `zcode.z.ai` / `chat.z.ai` / `api.z.ai`，
**把源码里的 Polaris 默认值整片盖掉**——这是"改了品牌却仍请求官方接口"的真正原因，
也解释了几次实测里看到的官方域名请求。

已加构建期闸门 `packages/desktop/scripts/polaris-endpoint-guard.mjs`：摘掉上游域名并告警，
之后回落到源码默认；需要对照官方验证迁移时设 `POLARIS_ALLOW_UPSTREAM_ENDPOINTS=1`。

> **发布前必查**：构建日志里不应出现 `[polaris] 已从构建端点环境中摘除上游域名`，
> 或确认产物 `main/preload/host` 里官方域名为 0 个文件（当前实测为 0）。

### 7.3 有意保留（不在删除范围）

| 项                                                        | 原因                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 套餐线剩余 UI（45 个文件 / 7,554 行）                     | 运行时已中和（规格数组为空、无官方 provider、产物里 0 处标识），但被 **26 个非套餐文件（31,231 行）** 静态引用（设置页/会话面板/DI 容器/窗口 chrome）。删干净需专门一轮外科改造，收益只是整洁——留给独立一轮做，不在收尾里动刀 |
| `bigmodel.cn` 匹配键（`legacyZCodeConfigProviderReader`） | 只用于识别旧配置里残留的官方域名并改指自有网关，不发起请求                                                                                                                                                                    |
| marketplace 的 Z.ai 兼容镜像                              | 你设计的过渡降级：自有地址优先，官方作镜像，可用 `POLARIS_PLUGIN_MARKETPLACE_MIRRORS` 覆盖                                                                                                                                    |
| `@babel/runtime`                                          | bundle 校验脚本把它当主进程启动依赖兜底，1MB 不值得冒险                                                                                                                                                                       |
| `packages/zcode-server-cli`                               | 产品决策：保留（无头服务端 CLI）                                                                                                                                                                                              |
| `services/session/claude-native`                          | 产品决策：保留（Claude 历史导入）                                                                                                                                                                                             |

---

## 9. 本轮：启动日志归零 + CUA PiP 空转收口（2026-10-01）

> 目标：把「设计如此、但每次启动都刷屏」的噪音清掉；不动任何核心能力。
> 原则：不新增任何定时器/轮询；只改门控、日志级别与失败语义。

### 9a. CUA PiP 在未启用平台上的空转

PiP 只在 `platform === "darwin" && serviceAuthorityMode === "desktop-local"` 才可能启用
（`services/node.ts` 的 `cuaPipSessionEnabled`）。而 Windows/Linux 上整条投递链仍是活的：
每个 `turn-started`/`turn-ended` 与每次窗口 focus 变化都会走完 IPC → host → 服务，
最后以 `event delivery dropped { skipReason: "service-disabled" }` 被丢掉。

| 位置                                                                  | 处置                                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/services/src/cua-permission-broker/cuaPipSessionService.ts` | `publishFocus`/`publishLifecycle` 在 `!enabled` 时静默早退（不走 `resolveCredentials`、不打 warn）                                                                                           |
| `packages/services/src/node.ts`                                       | `onCuaPipSessionLifecycle` 挂载门控由 `authorityMode === "desktop-local"` 收紧为 `cuaPipSessionEnabled`；`lifecycleWired` 诊断同步改为 `cuaPipSessionEnabled`（原先恒报 `true`，会误导排查） |
| `packages/desktop/src/main/index.ts`                                  | focus router 的 `send` 加 `process.platform !== "darwin"` 早退，非 macOS 连 IPC 都不发                                                                                                       |

### 9b. 三条「永远失败的远端调用」

三条都指向 `polaris.bitlesu.com/api/v1/client/configs`（自有后端未就绪）。它们本来就 fail-safe
到 bundled/本地配置，问题只在**失败被当成故障上报**：

| 位置                                                      | 问题                                                                                                                                                      | 处置                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/services/src/model-provider/providerRuntime.ts` | `refreshSources` 把旁路 Source 的 rejection 直接上抛，UI 启动即渲染 `[Root] 刷新 Provider Runtime 失败: Polaris Built-in client-config: invalid response` | 改为 best-effort：`allSettled` 后只让 Registry 刷新自身的错误上抛                                 |
| `packages/desktop/src/main/singleFeatureRollout.ts`       | 失败不更新 `snapshotExpiresAt`，每个调用点（Host 创建、窗口聚焦）都重打一发 3s 请求                                                                       | 失败也进 60s 负缓存；日志 warn → info；顺带修正指向已删除 `rendererActionTraceRollout` 的过时注释 |
| `packages/services/src/node.ts`                           | `onZCodeBuiltinRefreshError` 用 warn + `{ error }`，Error 序列化成 `{}`                                                                                   | 降为 debug + 显式 `errorMessage`                                                                  |

### 9c. 实测（重启 dev 前后对比）

| 指标                                                  | 改前        | 改后                           |
| ----------------------------------------------------- | ----------- | ------------------------------ |
| `[Root] 刷新 Provider Runtime 失败`                   | 2           | **0**                          |
| `Built-in Config 远端刷新失败`                        | 每小时 1 条 | **0**                          |
| `config unavailable`                                  | 3           | 1（首次探测，之后 60s 负缓存） |
| `event delivery dropped`                              | 多处        | **0**                          |
| `[error]` / `[warn]` 行                               | —           | **0 / 0**                      |
| `dom-ready` / `reattached` / boot 看门狗 / 运行期自愈 | —           | 1 / 0 / 0 / 0（健康）          |

门禁：`oxfmt --check` ✅、`pnpm typecheck` ✅、`oxlint` 0 errors、`architecture:check` 0 violations、
desktop `tsup` 4/4、harness 7/7 + 7/7 + 16/16。

### 9d. 明确保留：`@zcode/telemetry`（产品决策）

**结论：保留，不砍。** 理由（按「核心能力不能丢」这条硬约束）：

1. 它是**与品牌无关的通用 OTLP 可观测层**，不是 Z.ai 业务：导出地址完全由
   `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `..._METRICS_ENDPOINT` / `..._ENDPOINT` 决定，
   可以直接指向自有 collector。
2. **默认惰性**：`prepareModelTelemetryEnv` 在拿不到 trace endpoint 时直接原样返回，
   连 OTel SDK/Exporter 都不 import——无序启、无定时器、无网络。
3. 它的端口（`AgentExecutionTelemetryPort` / `ModelExecutionTelemetryPort`）贯穿 agent
   执行链（core runtime / tool executor / contracts / bootstrap / workflow），共 49 处引用、
   约 60–80 文件。删除是**穿心一刀**，与「所有核心功能都不能丢」直接冲突，收益仅为整洁。

同理保留 `desktop-context-prompt` 的首次远端探测（info 级 + 60s 负缓存）：自有后端上线后
灰度开关可自动恢复生效，不写死。

残余的 `zcode.*` 指标/属性名（`apps/zcode-cli/packages/telemetry/src/agent-metrics.ts` 等）
保留：它们是 OTLP 指标标识符而非用户可见品牌，重命名会让既有看板/告警全部失联。

### 9e. 已知但未动（待你决定）

| 项                                                                                               | 现象                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `[cua-product-helper] Windows CUA Helper runtime resolution failed { invalid-runtime-manifest }` | 启动时 host-log 一条；属 Windows CUA 打包运行时问题，不在本轮清单内                      |
| renderer 活着但什么都不干的静默挂起                                                              | 只有轮询能发现，已按你的原则否掉轮询；当前仅有「进程 gone / unresponsive」事件驱动的自愈 |

## 10. 终扫：孤儿源文件与死资源（极保守）

扫描器：`scripts/find-orphans.mjs`（未提交）。方法：`git ls-files` 取全部源码，用 TypeScript
`preProcessFile` 抽 import/require/动态 import 说明符，再解析回真实文件路径，逐文件统计「入度」，
入度为 0 的列为疑似孤儿；入口 / `package.json` 的 `exports|bin|main` / 测试 / 构建配置 / 字符串引用
一律计为「被引用」。已处理三类别名：`@/`（ui 的 tsconfig paths）、`@zcode/*` workspace exports、
以及 `#src/*`（services 的 Node subpath imports）。

结论：3818 个候选中仅 2 个确认 0 引用并删除，其余全部保留。

### 10a. 实际删除（0 引用证据）

| 文件                                                    | 0 引用证据                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/ui/src/components/ui/accordion.tsx`           | `git grep -i accordion -- '*.ts' '*.tsx'` 全仓只剩文件自身；非 `@zcode/ui` 导出项、无 importer |
| `packages/desktop/scripts/conversation-docker-plan.mjs` | 纯导出 helper，全仓 0 importer、不在任何 package.json script；其标记文档已不在仓库             |

### 10b. 资源扫描：0 删除

`packages/ui/src/assets/**` 48 个文件全部被静态引用（`channel-icons` 经 index.ts、`provider-icons`
经 ProviderLogo/oauthProviderIcon、`plugin-icons`/`feature-prompt-icons`/`onboarding/assets` 经
`featureSuggestedPrompts` 等）。`packages/desktop/build/**` 12 个文件由 `electron-builder.config.js`
打包引用（`icon.icns/ico/png`、`icon_installer.*`、`icon_windows.png`、`icons/512x512.png`、
`dmg_background.png`、`entitlements.*.plist`）；其中 `icon.icns`、`dmg_background@2x.png`、
`entitlements.helper.plist` 静态搜不到但由 electron-builder 按约定 / 变体 / helper 配置引用，保留。
`material-icons` 由 `fileDisplay.tsx` 按运行时 base URL + 扩展名动态解析，全部保留。`public/icon_512@2x.png`
经 `new URL()` 引用；`packages/web/public/favicon.ico` 为浏览器约定请求的公共资源，保留。

### 10c. 疑似但保留（克制清单）

| 文件                                                                                                                                                                                                     | 保留理由                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/desktop/src/{host/tasksStorageWorker,main/storageScanWorker}.ts`、ui 两个 `*.worker.ts`                                                                                                        | 经 `new Worker(new URL("./x.worker.js", import.meta.url))` 加载，静态 import 扫不到      |
| `packages/services/src/storage/module.ts`、`packages/server/build-remote.ts`、`packages/zcode-server-cli/src/packaging/stageCli.ts`、`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/replay.ts` | knip entry / package.json script / package exports 子路径入口，属公开出口                |
| `apps/zcode-cli/packages/browser-use-plugin/src/browser-client.ts`、`apps/zcode-cli/tools/prompt-trajectory/src/cli.ts`                                                                                  | knip entry / 独立 CLI 工具入口                                                           |
| `packages/desktop/scripts/ttft-otlp-receiver.mjs`                                                                                                                                                        | 本地 OTLP 验收接收器，对接**保留**的 `@zcode/telemetry`；头部注释即用法说明              |
| `apps/zcode-cli/scripts/shadow-replay.mjs`、`scripts/zcode-distribution-smoke.mjs`、`apps/zcode-cli/packages/dynamic-workflow/scratch/run.mjs`                                                           | 手工运维/发布/scratch 工具，头部含完整用法文档                                           |
| `.agents/**`（83）、根/包内 `scripts/**`、`*.config.ts`                                                                                                                                                  | 技能文档随附脚本 / 构建与发布脚本，按路径字符串或 package.json script 调用               |
| `packages/rpc/examples/*`                                                                                                                                                                                | 示例代码，刻意不被 import                                                                |
| `packages/ui/src/assets/{model-icons,provider-icons}/**`                                                                                                                                                 | 品牌图标系统（红线），动态解析；即使 `model-provider-logo-sources.json` 未静态命中也不删 |

门禁：`pnpm typecheck` ✅ 0 错误；`pnpm lint` 90 warnings + 1 error（**均 pre-existing**，唯一 error 是
受保护文件 `packages/ui/src/assets/model-icons/modelIconShapes.ts` 的超长行，与本次无关）；
`oxfmt --check scripts/find-orphans.mjs` ✅。

## 11. 用户可见品牌终审（zcode → Polaris）

结论：**用户可见面已全部是 Polaris**。逐面核验：`<title>Polaris</title>`（desktop/web）、
`productName: Polaris`、`app.setName()` = Polaris / Polaris Dev / Polaris Preview（同时决定 userData 目录名，
避免与官方 ZCode 的 `%APPDATA%/ZCode` 互覆）、托盘 `tray.tooltip` = Polaris、涉及菜单「关于 Polaris」/
「Polaris Endpoint」/「打开 Polaris」、Endpoint 弹窗标题 `Polaris Endpoint`、Linux 深链 `Name=Polaris`、
`ZCodeAboutLogo` 仅为兼容壳（实际渲染 `PolarisAboutLogo`）。i18n 文案值中无 `ZCode`/`Z.ai`/`智谱`。

**按约定不处理的内部项**（不可见 + 改名=穿心大改）：`@zcode/*` 包名、`ZCODE_*` 环境变量、CLI 可执行名
`zcode`、协议串 `"ZCode Protocol/1"`、注册表遗留键 `ZCode.OpenInZCode`、迁移用旧路径 `%APPDATA%/ZCode`、
以及大量仅内部使用的函数名/注释。

**本轮修复的两个用户可见瑕疵**：

| 问题                                                                                                                                                               | 修复                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `login.oauth.regionTag.zai` / `.bigmodel` 被 `botsUi.ts` 返回并在 BotsDialog / 远程控制弹窗 `formatMessage`，但 `0d60c52` 清理品牌时把这两个键删了 → 渲染成原始 id | 按删除前原值恢复：zh 全球/中国、en Global/CN（区域名，与品牌无关） |
| 反馈工单正文/`agentProvider` 字段写死 `"ZCode Agent"`                                                                                                              | 改为 `"Polaris Agent"`（常量重命名 `FEEDBACK_AGENT_LABEL`）        |

门禁：`pnpm typecheck` ✅ 0 错误；`pnpm lint` 89 warnings + 1 error（仅 pre-existing `modelIconShapes.ts`
超长行）；`oxfmt --check` 4 个改动文件全部 ✅。

## 12. Agent 能力完整性审计（运行时实测）

工具注册表：`apps/zcode-cli/packages/core/src/tool/handlers/index.ts` 的 `builtInTools` 数组，
入口 `registerBuiltInTools`。这一层**不在根 `pnpm typecheck` 覆盖范围**（根 tsconfig 不含 apps/zcode-cli），
必须单独验。

实测方式：esbuild 把 `registry.ts + handlers/index.ts` 打成 CJS，`node` 直接跑 `createToolRegistry()` +
`registerBuiltInTools(...)` 并枚举。

| 场景                                         | 结果                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 桌面 main-agent（所有端口在场）              | **40/40 工具全部注册**                                                                      |
| 默认（无选项，最小集）                       | 27 个（13 个按端口/灰度门关闭，符合预期）                                                   |
| `@zcode/contracts` + `@zcode/core` typecheck | ✅ 5/5（`turbo run typecheck --filter` 顺序跑）                                             |
| 契约完整性                                   | 39 个 provider 可见工具**全部带 input schema**                                              |
| workflow_child 结构性禁用                    | `CreateWorkflow/SaveWorkflow/AmendWorkflow/EvalWorkflowSnippet/ResumeWorkflowRun` 未泄漏 ✅ |
| 工具 handler 是否依赖已砍业务                | **无**（不 import `business/`、`official-mcp`、`coding-plan`、`zai/bigmodel`）              |

完整能力面（40）：Read/Write/Edit/Bash/Glob/Grep/WebFetch/WebSearch/TodoRead/TodoWrite/
EnterPlanMode/ExitPlanMode/AskUserQuestion/SendMessage/RespondToCoordinator/submit_result/escalate/
TaskOutput/TaskStop/ReadSessionContext/Agent/Task/Skill/js/Cron×4/OffPeak×2/CreateWorkflow/AmendWorkflow/
SaveWorkflow/EvalWorkflowSnippet/ListWorkflowRuns/GetWorkflowRun/ResumeWorkflowRun/
ResolveWorkflowQuestion/ListSavedWorkflows/ListModels。

### 12a. 垃圾业务代码清理状态

| 目标线                | 状态    | 证据                                                              |
| --------------------- | ------- | ----------------------------------------------------------------- |
| 桌面遥测链 / ARMS·RUM | ✅ 已砍 | 全仓 `@arms/`、`arms/rum` 0 命中                                  |
| bingmodel 包          | ✅ 已砍 | 0 文件；仅剩 `bigmodel` 作为**历史 provider id**（迁移/兼容映射） |
| 官方套餐线 UI/业务流  | ✅ 已砍 | ProviderTemplatePicker 注明官方计费模板已移除                     |

### 12b. 仍在但刻意不动的“背景线”（用户不可见，删除=穿心大改）

| 项                                                                    | 为何保留                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/services/src/coding-plan-subscription/**`                   | 已接进 `node.ts` / `accessor.ts` / `client/remoteServiceAccess.ts` 服务图 |
| `packages/services/src/official-mcp/**` + `shared/src/official-mcp-*` | `zcodeAgentService` 发放审计在用                                          |
| `BUILTIN_MODEL_PROVIDER_IDS`（zai/bigmodel 官方套餐 id）              | `shared/model-provider-types.ts` 导出，被迁移映射与类型引用               |
| DB 迁移 `0020` / `0022` 里的 `builtin:bigmodel → bigmodel-api`        | 历史迁移不可改                                                            |

另：`apps/zcode-cli` 的 `registry:check`（bash 命令注册表新鲜度门）**当前是 stale**，与本次改动无关
（生成器依赖 fig 规范），属 pre-existing，未处理。

## 13. 本轮：开发期 HMR Context 身份崩溃根治（2026-10-01）

**症状（真机日志实证）**：编辑 locale / store 等被 Provider 模块间接引用的文件时，Vite HMR 会重载
`IntlProvider.tsx` / `StoreProvider.tsx`。若 Context 对象与 Provider 定义在同一模块，Context 会换新身份，
已挂载的旧 Provider 子树读到 `null`，子级 hook 抛错并被 `AppErrorBoundary` 捕获：

| 错误                                           | 09-29 | 10-01 | 09-23 |
| ---------------------------------------------- | ----- | ----- | ----- |
| `useZCodeIntl 必须在 ZCodeIntlProvider 内使用` | 1278  | 50    | 20    |
| `useZCodeStore 必须在 StoreProvider 内使用`    | 86    | 4     | 18    |

栈里模块 URL 带 `?t=...` 且同批更新多个模块，确证是 HMR 而非运行时逻辑缺陷（冷启动 0 崩溃）。

**修法**：把 Context（及其消费 hook）拆到**不引用易变模块**的稳定文件，Provider 组件模块只负责挂载。

| 新稳定模块                                 | 内容                                                          | 运行时依赖                                  |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| `packages/ui/src/i18n/intlContext.ts`      | `IntlContext` + `useZCodeIntl`                                | 仅 `react`（`@zcode/shared` 仅类型）        |
| `packages/ui/src/store/storeContext.ts`    | `StoreContext` + `useZCodeStore` / `useZCodeStoreWithDefault` | 仅 `react`/`zustand`（`./index.js` 仅类型） |
| `packages/ui/src/store/tabStoreContext.ts` | `TabStoreContext`                                             | 仅 `react`（`./tabStore.js` 仅类型）        |

`IntlProvider.tsx` / `StoreProvider.tsx` / `TabStoreProvider.tsx` 保持原有导出面（re-export hook），调用方无需改动。

**验证（真机 dev 实例，pid 44096）**：

- 门禁：`pnpm typecheck` ✅ 0 错；`oxlint`（i18n/store）0 warn 0 err；`oxfmt --check` ✅。
- 在运行中的 dev 上做 HMR 探针：改 `IntlProvider.tsx`、改 locale 文件、改 `StoreProvider.tsx` 各触发一次热更，
  日志**均无** `useZCodeIntl/useZCodeStore ... 内使用` 崩溃，也**无整页 reload**（无 `dom-ready`）；
  仅重构模块的第一次热更出现一次自愈的 `removeChild`（React Fast Refresh 结构性重排产物，dev-only）。
- 修复前同操作会连抛 5 条 `AppErrorBoundary` 并整页重载。

**注**：`removeChild` 是 React Fast Refresh 在模块结构变化时的已知瞬态产物，被错误边界兜住并自愈，
不影响已构建产物；本仓 `packages/ui/src/v4/*Context.tsx`、`hooks/useServices.tsx`、`hooks/usePlatform.tsx`
等仍是「Context 与 Provider 同模块」写法，若后续再遇同类 HMR 崩溃可按同一模式拆分。

## 14. 本轮：一次错误的「越界改动」及回退（2026-10-02）

**结论：`apps/zcode-cli` 属于内置的用户依赖（随产品打包，终端用户看不到），不在改动范围内。**
本轮曾在其下做了 4 处改动，依据「只改用户可见面 + 可被找到的存储路径，其他一律不动」的
边界，已**全部回退到 HEAD**，工作区不再包含 `apps/zcode-cli` 的任何 diff。

被回退的改动（连同为其服务的锁文件 / 清单编辑一并还原）：

| 曾改动                                                                                                          | 内容                                   | 回退方式                                            |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `apps/zcode-cli/packages/tui/src/app-empty-transcript.tsx`                                                      | ASCII 字标 `ZCODE` → `POLARIS`         | `git checkout`                                      |
| `apps/zcode-cli/packages/tui/src/app-sidebar.tsx`                                                               | `PRODUCT_NAME` `"ZCode"` → `"Polaris"` | `git checkout`                                      |
| `apps/zcode-cli/scripts/generate-bash-command-registry.mjs`                                                     | hash POSIX 归一化                      | `git checkout`                                      |
| `apps/zcode-cli/packages/swift-bridge/`（整包删除）+ 两份 lockfile importer + `third-party/inventory.json` 条目 | 空壳包清除                             | `git checkout`（文件 / 目录 / 锁文件 / 清单均还原） |

**经验教训**：`apps/zcode-cli` 是随产品内置的第三方 CLI 依赖，即使 TUI 界面在本机演示时
「看得到」，它也不属于我们要重命名的自有用户可见面；判据是「是不是我们自己的产品外观 /
可被用户找到的存储路径」，而非「本机运行能不能看见」。后续扫描只覆盖 `packages/**` 中
真正面向终端用户的品牌串与落盘路径。

**同轮复核结论（仍然有效）**：孤儿扫描 156 个候选**全部至少有一处字符串引用**，零「绝对
孤儿」，该层已无安全可删项。

## 15. 本轮补记：working tree 正确性复检（2026-10-02）

目标：把当前未提交改动逐一复用门槛验证，找出「会出错」的点。

**门禁（本机实测）**：`pnpm typecheck` ✅ 0 错误；`oxlint`（改动 9 个文件）✅ 0 warn/0 err；
`oxfmt --check`（同 9 个文件）✅；`node scripts/architecture/architecture-check.mjs check` ✅
0 violations。

**发现的唯一悬空引用（已修）**：§10 删除 `packages/ui/src/components/ui/accordion.tsx` 时，
`third-party/inventory.json` 里它的两处登记没有同步删除——`inputs` 哈希表 1 处、`copied`（shadcn
组件）`files` 数组 1 处。`licenses.mjs check` 会逐个 `readFile` `manifest.inputs`，所以这条悬空
会让门禁抛 ENOENT。已按「重新生成会得到的形态」精确删除这两条（notices 只提到 `@radix-ui/react-
accordion` 这个**包**，不引用源文件，故 `noticesSha256` 不变）。

**同轮发现的 pre-existing 归零项（未动，非本会话造成）**：`third-party/inventory.json` 整体已
陈旧——用与 `readVerifiedNotices` 等价的逻辑扫全表：`inputs` 缺失 **34**、哈希不匹配 **10**、
`copied.files` 缺失 **31**（多为早前被删的 `packages/ui/src/components/ai-elements/*` 与
`packages/rpc/src/network-telemetry-middleware.ts`，以及改名过的 `package.json`/`pnpm-lock.yaml`/
`dialog.tsx`/`ZCodeAboutLogo.tsx` 等）。即 `node scripts/licenses.mjs check` **在本轮之前就已是红**。
该门禁为**手动**（`package.json` scripts 与 `.gitlab/**` 均无引用），且重新生成依赖 `pnpm -r ls`，
本机 Windows 会 EMFILE（§21 已记录）。故本轮不手工重写 75 条，留待具备句柄预算的机器跑
`node scripts/licenses.mjs notices` 恢复生成式一致。

**其他复检结论**：`useZCodeIntl` / `useZCodeStore` / `useZCodeStoreWithDefault` / `TabStoreContext`
的导出面与改名前的全部 importer 兼容（typecheck 证）；`StoreContext`/`TabStoreContext`/`IntlContext`
无任何模块按名外部导入（旧注释「导出供测试注入」已过时）；`login.oauth.` 前缀仅 `regionTag.{zai,
bigmodel}` 两条被 `botsUi.ts` 使用且均已恢复，无其他 raw-key 渲染风险；`login.expired.*`、
`welcome.login*` 确无引用。i18n 文案**值**中无 `ZCode`/`Z.AI`/`智谱`。

**本轮续：生成式修复实测被环境阻断 + 另一处陈旧登记（2026-10-02，同一轮）**

尝试用权威方式重生成 inventory：`node scripts/licenses.mjs notices` ❌
`pnpm -r ls --prod --json --depth Infinity --lockfile-only` → `EMFILE: too many open files,
open '.../dom-serializer/package.json'`（与 §21 同一阻塞）。生成器只在最后两行 `writeFile`（notices 与
inventory），失败发生在之前，**未写任何文件**，故本轮的手工定点修仍成立。

顺带发现同一重生成链路上的第二处陈旧登记：`third-party/copied-components.json` 的 `ai-elements` 组件
`modifiedFiles` 仍列着已删的 `packages/ui/src/components/ai-elements/{agent,artifact,canvas,checkpoint,
commit,confirmation,connection,controls,conversation,edge,image,node,panel,persona,plan,prompt-input*,
queue,sandbox,shimmer,snippet,sources,suggestion,task,terminal,test-results,toolbar}.tsx`。
生成器的校验是「`modifiedFiles` 必须在 `roots` 扫描结果里，且文件内含 `Modified by ZCode:`」——若重生成能
跑起来，这一步会抛 `Modified source outside copied roots`。同样受 `pnpm -r ls` 阻塞，属同一 pre-existing 陈旧，未手工修。

**其他门槛实测**：`pnpm lint` 全仓 89 warnings + **1 error**（唯一 error 为受保护的
`packages/ui/src/assets/model-icons/modelIconShapes.ts` 521 行 `max-lines`，pre-existing）；
本轮改动 9 个文件 `oxlint` 0/0。`node scripts/check-workspace-freshness.mjs` ✅ 基线新鲜
（enterprise 与 origin/enterprise 同步，ahead 39 / behind 0）。打包/产品身份面（`electron-builder.config.js`、
`build/**`、各 `index.html`/manifest、`productName`/`appId`）无用户可见 `ZCode` 残留。

**再扫一轮（i18n 与配置引用）**：

- 新增扫描器 `scripts/find-missing-i18n-keys.mjs`（未提交）：扫全仓 `id: "..."` 字面量（2403 个带点 id）
  → **en-US 缺失 0**，即没有 raw-id 渲染风险（`createIntl` 的回退是 `messages[id] ?? id`，缺键会直接显 id），
  并用同一脚本对比 en/zh 键集合。
- 唯一差集：`settings.memory.viewer.disabled` 只存在于 en-US。**但 `git grep` 确认它 0 处引用**，是死键而非缺译；
  且 `packages/ui/src/i18n/locales/*` 属「品牌文案文件（其他代理在改）」红线，故未动，仅登记。
- `knip.json` 的 desktop `entry` 列了 `packages/desktop/scripts/sign-windows-hook.cjs`，该文件不存在
  （`git log` 无历史，`electron-builder.config.js` 的 `win` 段也不引用任何签 hook）——悬空但无消费者、
  且 knip 因 OOM（oxc-parser 申请 1 GiB）不可运行。未动，登记。
- `packages/web/dist`、`packages/desktop/dist`、`packages/ui/dist` 等构建产物均被 `.gitignore` 忽略
  （未跟踪）。产品身份值复核：`linuxExecutableName`/`linuxPackageName` = `polaris`/`polaris-preview`，
  `appId` = `com.bitlesu.polaris[.preview]`，`productName` = Polaris / Polaris Preview；唯一 `zcode` 是
  dev 态 AUMID `cn.aminer.zcode`（刻意保留的本地旧身份，不随正式包发布）。

**再扫一轮：真正的用户可见漏网——Bots 文案（已修）**

- `packages/services/src/bots/messages.ts`（bot 经飞书 / Telegram / 微信发给用户的回复目录）4 处仍是旧品牌：
  zh 的 `userNotBound`（「在 zcode UI 生成绑定码」）、`permissionExpired` / `elicitationExpired`
  （「在 zcode UI 中处理」）、`remoteReconnectUnavailable`（「请先在 ZCode 打开该远端项目」）；en 同 4 处。
  同一文件的 `bindCodeInvalid` / `helpTitle` 已经是 Polaris，属半成品改名。已全部改为 `Polaris UI` / `Polaris`。
- 三个 channel runtime 的兜底 `message`（`weixin`/`telegram`/`feishu`）`"... handled by another ZCode window."`
  → `Polaris window`。对应 i18n 键（`bots.runtime.*LongPollingHandledElsewhere`）在 locale 里已是 Polaris，
  但 runtime 兜底串漏改；weixin / feishu 这条没有 `messageId`，会直接展示。
- 复核：`ZCODE_AGENT_PROVIDER_LABEL = "ZCode Agent"` 仅被**死导出** `BOT_ZCODE_PROVIDER_OPTIONS`
  （全仓 0 引用）引用，非用户可见，未动。
- 仍未动的 ops / 内部错误串（非产品 UI）：`provider-node` 的 `ZCode Built-in ...` 配置校验错误、
  `zcode-server-cli` 的 `Another ZCode Server instance is already running`、`updatePreparation` 的服务器错误——
  留待确认是否一并改品牌。
- 门禁：`pnpm typecheck` ✅；4 个改动文件 `oxlint` 0/0、`oxfmt --check` ✅。

## 16. 收尾验收：核心功能实测 + CLI/TUI 用户可见品牌补漏（2026-10-02）

### 16a. 门禁四绿（本机实测）

| 门禁                 | 结果                                |
| -------------------- | ----------------------------------- |
| `pnpm typecheck`     | ✅ 0 错误（11 项目）                |
| `pnpm lint`          | ✅ 0 errors / 89 warnings（均既有） |
| `pnpm fmt:check`     | ✅ 全通过                           |
| `architecture:check` | ✅ 0 violations / 0 new             |

### 16b. Agent 核心能力实测（编译级，非静态扫描）

方法：`tsx` 直跑 `apps/zcode-cli/packages/core/src/tool/{handlers/index,registry}.ts`，
按桌面 main-agent 全端口在场注册并枚举。

| 指标                    | 结果                        |
| ----------------------- | --------------------------- |
| `builtInTools` 数组     | **40**（含 2 个注释停用项） |
| 实际注册工具            | **38**                      |
| provider 可见契约       | **37**                      |
| 缺 `inputSchema` 的契约 | **0**                       |

工具名单（38）：Read/Write/Edit/Bash/Glob/Grep/WebFetch/WebSearch/TodoRead/TodoWrite/
Cron×4/OffPeak×2/EnterPlanMode/ExitPlanMode/AskUserQuestion/SendMessage/RespondToCoordinator/
submit_result/escalate/TaskOutput/TaskStop/ReadSessionContext/Agent/Task/Skill/js/
CreateWorkflow/AmendWorkflow/SaveWorkflow/EvalWorkflowSnippet/ListWorkflowRuns/GetWorkflowRun/
ResumeWorkflowRun/ResolveWorkflowQuestion/ListSavedWorkflows/ListModels。

结论：**核心能力零丢失**。

### 16c. 桌面实例启动链路实测（真机 dev，pid 55688/60472）

`creating main window` → `dom-ready fired` → `forked host process` → `local services ready,
all channels registered` → `ZCode agent process start` 全链路正常。

22:09 启动后日志：**1 条 error**（`[cua-product-helper] Windows CUA Helper runtime resolution
failed {invalid-runtime-manifest}`，§9e 已登记的 Windows 打包问题）、2 条 warn（Node SQLite
ExperimentalWarning + CUA broker_unavailable）。无白屏、无 watchdog 触发、无 host 崩溃。

### 16d. 本轮修复：CLI/TUI 用户可见品牌（6 文件）

CLI/TUI 是 README 明示的「命令行版」发行形态（用户以 `zcode` 命令使用），其文案属用户可见面。

| 位置                                                     | 原文                                          | 改后                                  |
| -------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| `i18n/locales/{zh-CN,en-US}.ts`                          | `ZCode Protocol stdio app server`             | `Polaris Protocol stdio app server`   |
| `cli/src/provider-runtime-env.ts` ×2                     | `` `ZCode Built-in ...` ``                    | `` `Polaris Built-in ...` ``          |
| `cli/src/provider-runtime-env.ts` ×2                     | `无法定位 CLI ZCode Built-in Provider Config` | `...Polaris Built-in...`              |
| `tui/src/app-sidebar.tsx`                                | `PRODUCT_NAME = "ZCode"`                      | `PRODUCT_NAME = "Polaris"`            |
| `cli/src/{prompt-command,tui-prompt-handler-runtime}.ts` | `ZCode app factory is unavailable.`           | `Polaris app factory is unavailable.` |

注：协议标识符 `ZCODE_PROTOCOL_NAME` 的值早已是 `"Polaris Protocol"`（§20 轮次），
CLI 帮助文案是当时的漏网，本轮补齐。CLI 重建后实测 `--help` 输出 `Run the Polaris Protocol
stdio app server` ✅。

**明确不改**（内部标识，用户不可见）：`ZCodeCopy` / `getZCodeCopy` / `createZCodeApp` 等类型与函数名、
`zcode-agent`/`zcode-host` 进程标识、`@zcode/*` 包名、`ZCODE_*` 环境变量、CLI 命令名 `zcode`
（`bin` 同时暴露 `polaris` 与 `zcode`，兼容既有脚本）。

## 17. 合并上游 feat/ui-plugin：UI Plugins + Gen UI（2026-10-03）

上游 `feat/ui-plugin` 分支（`662c30b`，2026-09-29）带来 426 文件 / +55,671 行的能力扩展：
**UI Plugin**（MCP Apps 交互式插件页面，Excalidraw 为例）与 **Gen UI**（Agent 按需生成
可交互 HTML 页面嵌入对话）。这是**能力层扩展，非业务功能**，零官方域名、零官方依赖，故合并。

### 17a. 冲突处置（9 文件真冲突，18 个冲突块）

保留原则：**新能力全收，已砍业务不回滚。**

| 文件                                      | 处置                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/channels.ts`                  | 保留 `PluginSandboxRegisterRequest`（新能力）；丢弃 `NetworkTelemetryBatch`（已砍遥测）                                                                                                        |
| `shared/src/validation.ts`                | 保留 pluginSandbox schema + `mcpAppInstanceSchema`；丢弃 `hostNetworkTelemetryBatchResponseSchema`、`networkObservationSchema`、`automationSessionCreateTelemetrySchema`；清理 3 个重复 import |
| `desktop/tsup.config.ts`                  | 端点闸门（我方）与 Gen UI 资源拷贝（上游）**都保留**                                                                                                                                           |
| `desktop/src/main/index.ts`               | 保留 `pluginSandbox` import；丢弃 `mainMemoryDiagnosticsRegistry`（遥测链，唯一消费者 `desktopResourceTelemetry` 已删）                                                                        |
| `desktop/src/host/index.ts`               | 保留 `hostMemoryDiagnosticsLog`（本地日志）+ `pluginSandboxRegistrationBridge`（新能力）；丢弃 `stopHostNetworkTelemetry`/`hostSelfResourceTelemetry`/`disposeLocalResourceTelemetry`（已砍）  |
| `desktop/src/main/desktopHostProcess.ts`  | 保留 `RemoteTarget` + `TaskRealtimeBus`；丢弃 `HostMcpTelemetryResponse`/`HostSessionCreateTelemetryResponse`；删除 3 个指向已删文件的死 import                                                |
| `desktop/src/main/desktopWindowChrome.ts` | 保留 pluginSandbox guest 分支 + 浏览器硬化逻辑；**丢弃 Coding Plan 官网 webview 分支**（`isCodingPlanEmbeddedWebviewSrc`/`codingPlanWebviewPreloadPath`/`isCodingPlanGuest`，已砍）            |
| `ui/src/v4/SessionPane.tsx`               | 保留 Gen UI 上下文注入（`buildGenUiModelContext` + `genUiService.listState`）；丢弃 `onAcceptedSelection`/`recommendStartPlan`（已砍推荐线）                                                   |
| `pnpm-lock.yaml`                          | 手工冲突丢弃，改用 `pnpm install --lockfile-only` 权威重建                                                                                                                                     |

### 17b. 品牌化（用户可见面）

| 位置                                         | 改动                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pluginSandbox/permissions.ts`               | 权限对话框文案（中/英）`ZCode 的沙箱` → `Polaris 的沙箱`、`ZCode restarts` → `Polaris restarts` |
| `pluginSandbox/permissionGate.ts`、`host.ts` | 默认 server 名 `"ZCode Gen UI"` → `"Polaris Gen UI"`                                            |
| `UI_PLUGIN.md` / `UI_PLUGIN.en.md`           | 产品名 7 处 → Polaris；**上游仓库引用 `zai-org/ZCode` 保留**（事实）                            |

### 17c. 明确保留的内部标识（契约，不改）

`useZCodeIntl`/`ZCodeCopy` 等类型与 hook 名、`experimental["zcode/..."]` MCP 扩展键
（与插件生态的协议契约）、`@zcode/*` 包名、`ZCODE_*` 环境变量。
`zcodeMcpTelemetryEventSchema` 是 agent 协议 schema（非桌面遥测），保留。

### 17d. 垃圾文件核查

- **保留**：`desktop/scripts/{mcp-apps-host-fixture,gen-ui-fixture}/`（被 `gen-ui-e2e.mjs`/`mcp-apps-host-e2e.mjs` 引用的 E2E 工具链）、`visualize-plugin/skills/visualize/assets/vendor/`（Gen UI 离线资产，916K，带 LICENSE）、`docs/images/{ui-plugins,gen-ui}/`（文档配图）。
- **新增源码零官方域名**（`*.invalid`/`*.test` 为测试假域名）。

### 17e. 验证

```
pnpm typecheck        ✅ 0 错误（含新增 300 文件）
pnpm lint             ✅ 0 errors / 92 warnings（+3，均为新增文件的既有风格）
pnpm fmt:check        ✅ 全通过
architecture:check    ✅ 0 violations
vitest（新增）        ✅ desktop pluginSandbox 24/24、shared 48/48、ui 142/142
  · 2 个 Failed Suite 为 node:test 格式文件被 vitest 误收，属预先存在的跑法差异（§20e 已记录）
tsx --test 复验       ✅ pluginMarketplaces 8/8
```

已砍业务零复活核查：遥测文件、`mainMemoryDiagnostics`、codingPlan 系列、`bigmodel-oauth` 全部确认未回归。
