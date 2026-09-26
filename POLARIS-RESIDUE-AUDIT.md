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
| 智谱系内置模板（2026-09-26 更新） | 已按**「砍官方计费套餐、留自带 key 通道」**执行：删 `zai-api` / `bigmodel-api` 与 8 条 `account:*` provider；保留 `zai-standard-api` / `bigmodel-standard-api`。详见 §7 |
| 阿里云 ARMS RUM SDK（4.8MB） | **已移除** |

---

## 7. 本轮：官方计费套餐与出网路径砍除（2026-09-26）

> 决策前提：**自有 AI 服务端尚未就绪**，因此不做「改指自有」的占位接入，能砍的直接砍；
> 等自有服务上线后再按「方案 B」接回。

### 7a. 内置 provider 配置（`config/provider/zcode-builtin.json`，revision 30 → 31）

| 处置 | 内容 |
|---|---|
| **删除** | 2 条官方计费模板：`zai-api`（Z.ai Coding Plan）、`bigmodel-api`（BigModel Coding Plan）。二者 access type 为 `zhipu-coding-plan-api-key`，绑定官方账号与计费 |
| **删除** | 8 条官方账号 provider，`providerRules` 清空：`account:{zai,bigmodel}-{individual,team}-coding-plan`、`account:{zai,bigmodel}-start-plan`、`account:{zai,bigmodel}-offpeak-idle-plan` |
| **删除** | 上述 6 条对应 `templateModelRules` |
| **保留** | 剩余 18 条模板：16 条第三方（moonshot / minimax / deepseek / qwen×2 / xiaomi / openai / anthropic / xai / openrouter / opencode×6）+ 2 条**自带 API Key 的标准通道** `zai-standard-api` / `bigmodel-standard-api` |
| **保留** | `access.type` 枚举与 `account:*` 常量全部留在代码里（`provider/src/config/*`、`shared/src/model-provider-types.ts`、`provider-selection-v2` 迁移别名、`official-glm-selection-v3` SQL）——接口契约不动 |

红线遵守：第三方 API Key 通道（含 GLM 自带 key）一条未动；`model-provider/` 抽象层文件未改。

### 7b. 官方出网路径收口

| 位置 | 处置 |
|---|---|
| `apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts` | **关闭**。删除硬编码 `https://zcode.z.ai/api/v1` 与 `/oauth/cli/*` 全部请求实现；工厂被调用即抛 `CliOAuthError`，类型/错误类保留 |
| `apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts` | **关闭**。删除 `ZAI_API_HOST = "https://api.z.ai"` 与 `/api/biz/...` 实现；工厂即抛 `CodingPlanApiKeyError` |
| `packages/services/src/model-provider/legacyZCodeConfigProviderReader.ts` | 删除生产分支兜底。旧 config 里保存的官方域名一律改指 `resolveBigModelApiOrigin()`；原常量降级为**匹配键**（不再作为请求地址） |
| `packages/desktop/src/main/desktopMainIpcRemote.ts`、`desktopWindowChrome.ts` | webview 白名单里的 `"https://api.z.ai"` 已删，只放行自有网关的 PayPal 中转地址 |
| `apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts` | `cdn-zcode.z.ai` 图标全部移除（8 处），插件 author 由 `Z.ai` 改为 `Polaris`。图标改由 `ui/src/lib/pluginIconSource.ts` 的打包素材按插件 id 命中，未命中时降级为中性占位图标 |
| `apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts` | **保留**。官方 baseUrl 只作路由匹配键，出网地址在 `:59-63` 改写为自有 origin |

### 7c. 文案

- `ui/i18n`：`presetTitle`「智谱」→「内置供应商」/「Built-in providers」；`presetDescription` 去掉「内置 Z.ai 与 BigModel 供应商，支持通过 OAuth 辅助完成配置」；`presetEmpty` 去掉 OAuth 提示；`namePlaceholder`「如：智谱 GLM」→「如：GLM-5.3」。
- **有意保留**：`templateGroup.zhipu`（「智谱」/「Zhipu」）、`login.apiKey.provider.zai`（「Z.ai」）等**第三方厂商名**——它们是这些 API 的真实提供方，改成 Polaris 会造成名实不符。
- `ProviderTemplatePicker` 的 zhipu 分组由 4 条收敛为 2 条自带 key 模板。

### 7c-2. 智谱系彻底清除（2026-09-26 第二刀，约 4000 行）

用户在运行态看到「内置两个：BigModel 与 Z.ai」后决定**全砍**（推翻 7a 的「留自带 key 通道」）：

| 处置 | 内容 |
|---|---|
| **删除** | 最后两条智谱系模板 `zai-standard-api` / `bigmodel-standard-api` + 48 条模板模型规则；内置模板只剩 16 条第三方（revision 32） |
| **删除** | `usage-stats/providers/` 全部 6 个文件（含 1606 行的 `BigModelUsageQuotaProvider`）、`model-provider/zaiStartPlanBilling.ts`、dead code `bigmodelStartPlanZcodeJwt.ts` |
| **改写为不使用官方链路** | `usageStatsService`：只保留 `getAppUsageSnapshot`（读本机 agent 数据库）；Coding Plan 四个方法抛 `coding_plan_removed`，`getEntitlementSnapshot` 返回 `not_configured` 空态（避免常驻请求报错），接口 `IUsageStatsService` 不变 |
| **连带清理** | desktop host 侧已无人使用的 `AccountRequestAuthService` / `AccountProviderCredentialService` / `OAuthCredentialRepo` 装配 |
| **保留** | `modelRules` 里以 `api.z.ai` / `open.bigmodel.cn` 为 `baseUrlMatch` 的条目 —— 它们是**静态匹配键**而非请求，且用户自建 provider 指向同一网关时仍需它们 |

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

| 位置 | 处置 |
|---|---|
| `packages/services/src/client-scenes/clientScenesService.ts` | 由「请求官方 `/api/v1/client/scenes`」改为**空实现**：`list()` 直接返回 `{ code: 0, msg: "", data: [] }`，不发网络、不抛错。接口 `IClientScenesService` 与工厂签名（依赖对象 `apiClient`）保持不变 |

效果：启动不再出现 `[v4-suggested-prompts] Client scenes 请求失败，推荐列表保持为空`；
首页推荐词与 Automations 模板目录稳定收敛为空态（自有后端上线后在这里实现 `list()` 即可）。

### 8b. 品牌残留

| 位置 | 原 | 改为 |
|---|---|---|
| `packages/provider-node/src/zcode-builtin-download.ts` | 错误串 `ZCode Built-in client-config: invalid response` | `Polaris Built-in …`（会经 `provider-settings.refresh` 冒到 UI 日志） |
| `apps/zcode-cli/packages/i18n/src/locales/{zh-CN,en-US}.ts` | CLI 启动横幅 `正在启动 ZCode…` / `Starting ZCode...` | `正在启动 Polaris…` / `Starting Polaris...` |

### 8c. 死代码 / 无用日志

| 位置 | 处置 |
|---|---|
| `packages/desktop/src/main/desktopHostProcess.ts` | 删除 `[spawnHostProcess] BIGMODEL_OAUTH_APP_SECRET source: …` 日志行——该 secret 在仓库中已无任何消费点，仅此一行引用，且不该在日志里点名 secret |
| `packages/shared/src/model-provider-family.ts` | 删除死代码 `resolveModelProviderFamilyIdByBaseURL` 与 `ModelProviderFamilySpec.rootDomain`（`rootDomain: "z.ai" / "bigmodel.cn"`）——审计确认零调用方 |

### 8d. 仍然存在（下一刀目标，按优先级）

1. **Built-in Config 远端刷新**（`node.ts:1534`）—— 自有后端未就绪，仍会每次失败一次。属**既定行为**；
   接自有后端后自动恢复。相关装配 `providerConfigRuntime` / `zcodeBuiltinRemoteConfig` 属抽象层，本轮未动。
2. **Coding Plan 业务 UI**（约 60 文件：`CodingPlanUpgradeDialog*`、`useCodingPlanProducts`、
   `useEnterpriseCodingPlanProducts`、`useStartPlanPreview`、`oauthTeamPricing`、`CodingPlanUsage*Panel`、
   `StartPlanBalanceCard` 等）——服务端实现已空壳化，这些组件现为纯死重；整块删除属较大重构，单独一刀处理。
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

| 文件 | 处置 |
|---|---|
| `packages/services/src/oauth/oauthService.ts` | 1223 行 → 空壳实现：接口 `IOAuthService` 与工厂 `createOAuthService(credentialService, deps)` 签名不变；`getProviders/getActiveProvider/restoreCachedSession/restoreSession/pollPendingOAuth/handleCallback` 返回空，`restoreCachedSessionState` 恒返回 `signed-out`，`startOAuth/startOAuthWithPolling` 抛可读错误，`logout/logoutAll/refreshToken/cancelPending` 无操作；保留非接口方法 `logoutIfCurrentCredentialRequest`（恒返回 false，不触发 JWT 失效广播） |
| `oauth/oauthProfileSchema.ts`（148 行） | **删除**（仅被 oauthService 引用） |
| `oauth/callbackAttribution.ts`（22 行） | **删除**（仅被 oauthService 引用；desktop 侧另有同名局部函数，不受影响） |
| `oauth/providerAdapter.ts`（47 行） | **删除**（仅为已移除适配器的类型契约，无引用方） |
| `oauth/runtimeConfig.ts`（33 行） | **删除**（原为官方 provider 运行时配置构造，无引用方） |

**保留（接自有账号时的 seam）**：`oauth/oauth.ts`（`IOAuthService` 接口）、
`oauth/repo/oauthCredentialRepo.ts`（通用凭据仓库，node.ts 仍在用于 onboarding userId / 账号身份）、
`oauth/oauthUnauthorizedRequest.ts`（401 分类，apiClient 引用）、
`oauth/oauthProviderLogout.ts`（派生 provider key 清理）。

净变更：约 **-1413 行**。`node.ts` / `remoteWorkspaceServiceCollection.ts` 装配点零改动（签名兼容）。

### 9b. 验证

`pnpm typecheck` ✅ 0 错误；`pnpm lint` ✅ 0 errors（80 warnings 均为既有）。

### 9c. 下一刀：`accountProvider*` 集群（待办）

`model-provider/accountProvider*`、`accountRequestAuthService`、`codingPlanProviderAvailability`、
`legacyTeamOrganizationResolver` 仍由 `node.ts` 装配（约 1000+ 行）。该集群与 **agent 侧**
（`zcodeAgentService` 的可选 `accountRequestAuthService`）、**provider provisioning**（`providerProvisioningTarget`）
以及 `oauthProviderLogout` 均有耦合，需谨慎分步处理：先空壳化 `accountRequestAuthService` 并简化 node.ts 装配，
再删已无引用方的 resolver / credential / apiKey 文件。
