# Polaris 待办：模型设置页残留（官方 provider 内置模板 / 远程同步 / 配额卡片）

> **状态：待办，用户 2026-09-23 明确「先不做」**
> **处置原则（用户原话）**：「这不是清理，这个可以进行一个保留但是要改成我们的，现在还在请求他们的接口呢」
> —— **保留能力，改指自有**；不是删除。

---

## 0. 现象（用户截图复现）

模型设置页与模型选择弹层里仍能看到 ZCode 官方的东西，并且**仍在向官方接口发请求**：

| 界面元素 | 现值 | 来源 |
|---|---|---|
| 供应商列表项 | `bigmodel-api`、`BigModel`、`Start Plan` | 内置模板 `config/provider/zcode-builtin.json` |
| 模型列表项 | `GLM Coding Lite`、`GLM-5.3` 等 | 同上 `templateModelRules` |
| 配额卡片 | `剩余额度`、`5 小时剩余 39%`、`工具调用 0%` | coding-plan 配额查询（官方 API） |
| 配额卡片标题 | `ZCode MCP 100%` | 官方套餐权益文案（品牌残留） |
| 模型选择弹层 | `BigModel 个人`、`bigmodel-api/GLM-5.3` | family 展示 + registry 分组标签 |

---

## 1. 三层结构（改之前必须理解清楚）

### 第一层：内置 provider 模板定义（纯数据，无请求）

- 文件：`config/provider/zcode-builtin.json`
- 加载点：`packages/desktop/src/main/desktopProviderConfig.ts:15`
  （读取 `"config/provider/zcode-builtin.json"`，可用环境变量 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 覆盖）
- 内容：
  - `providerConfigRules.templateRules`：20 条模板
    - **智谱系 4 条**：`zai-api`、`zai-standard-api`、`bigmodel-api`、`bigmodel-standard-api`
    - 第三方 16 条：`moonshot-kimi`、`minimax`、`deepseek`、`qwen-alibaba-model-studio-{cn,intl}`、
      `xiaomi-mimo`、`openai`、`anthropic`、`xai`、`openrouter`、`opencode-{go,zen}-{chat,messages,responses}`
  - `providerConfigRules.providerRules`：账号型 provider
    - `account:zai-{start-plan,individual-coding-plan,team-coding-plan,offpeak-idle-plan}`
    - `account:bigmodel-{start-plan,individual-coding-plan,team-coding-plan,offpeak-idle-plan}`
  - `modelConfigRules.*`：模型推荐配置（`templateModelRules` / `builtinProviderModelRules` 等）
- **注意**：第三方 16 条模板是**模型接入通道，红线，必须保留**。要处理的是智谱系 + 账号型条目。

### 第二层：远程同步器（**这才是真正在请求官方接口的地方**）

- 文件：`packages/provider-node/src/zcode-builtin-remote-synchronizer.ts`
- 机制：
  - 通过 `fetchRelease(endpointKey, signal)` 拉取官方发布的 `ZCodeBuiltinRelease`
  - 控制文件 `zcode-builtin-refresh.json`，数据文件 `zcode-builtin.json`
  - 节奏由 `successIntervalMs` / `leaseDurationMs` / `failureBaseDelayMs` 控制（带租约与退避）
  - 结果枚举：`"updated" | "unchanged" | "stale" | "missing" | "skipped" | "disposed"`
- 缓存路径（实测日志）：
  ```
  ~/.polaris/v2/runtime/provider/windows-x86_64/<version>/endpoint-<hash>/zcode-builtin.json
  ~/.polaris/v2/runtime/provider/windows-x86_64/<version>/endpoint-<hash>/zcode-builtin-refresh.json
  ```
- 相关文件：
  - `packages/provider-node/src/zcode-builtin-cache-paths.ts`
  - `packages/provider-node/src/endpoint-scoped-zcode-builtin-source.ts`
  - `packages/provider-node/src/zcode-builtin-download.ts`
- **风险**：即使 `config/provider/zcode-builtin.json` 改干净了，同步器仍可能**用官方下发的内容把本地配置覆盖回去**。
  所以第一层和第三层必须**一起处理**，只清模板文件是无效的。

### 第三层：配额 / 套餐数据（实时查询官方 API）

- UI：`packages/ui/src/settings/model-provider-section/`
  - `StartPlanCard.tsx` / `StartPlanQuotaStatusCard.tsx` / `StartPlanBalanceCard.tsx`
  - `CodingPlanStatusMeta.tsx` / `CodingPlanStatusActions.tsx` / `StatusCards.tsx`
  - `useCodingPlanEntitlements.ts` / `useCodingPlanProducts.ts` / `useStartPlanPreview.ts`
  - `codingPlanPricingCards.ts` / `codingPlanProductPresentation.ts` / `codingPlanEnterpriseTiers.ts`
- 服务端：`packages/services/src/coding-plan-subscription/`
  - `zaiCodingPlanSubscriptionProvider.ts`、`bigmodelCodingPlanSubscriptionProvider.ts` —— **已删**
  - `codingPlanSubscriptionService.ts` —— **已空壳化**（29/29 方法返回空，`satisfies ICodingPlanSubscriptionService`）
- **待确认**：空壳化之后这些卡片是否仍渲染骨架（用户截图里仍能看到 `剩余额度`、`5 小时剩余 39%`）。
  若仍渲染，说明数据来源不止 subscription service 一处，需要继续追。

---

## 2. 处置方案（两选一，**需要用户决策**）

### 方案 A：移除智谱系内置条目（最小改动）

1. `config/provider/zcode-builtin.json` 删除智谱系 4 条 `templateRules` + 8 条账号型 `providerRules`
   及对应 `modelConfigRules` 条目
2. 关闭/改指第二层同步器
3. 空分类在 UI 隐藏
4. 结果：内置供应商列表只剩第三方 16 家 + 用户自定义

### 方案 B：改造成 Polaris 自有内置模板（推荐，符合「改成我们的」）

1. 把智谱系条目**改写**为 Polaris 自有模板（例：`polaris-api`，`baseUrl` 指向中转站）
2. 让用户在「内置供应商」里开箱即用，不需要手动添加
3. 配额卡片接 Polaris 自己的额度接口
4. **需要用户提供**：中转站 `baseUrl`、是否需要中转站密钥托管

### 共同必做项（无论 A/B）

| # | 事项 | 位置 | 说明 |
|---|---|---|---|
| 1 | 断官方同步源 | `zcode-builtin-remote-synchronizer.ts` | 保留类与调用点，让 endpoint 指向 `polaris.bitlesu.com` 或直接禁用拉取（env 开关），**不再向官方发请求** |
| 2 | 品牌文案 | 配额卡片 `ZCode MCP` 等 | 改为 Polaris 文案（i18n 两个 locale 一起改） |
| 3 | 分类标签 | `bigmodel-api` / `BigModel 个人` | 随模板条目一起处理 |
| 4 | 实测验证 | — | 抓包/日志确认不再出现官方域名请求 |

---

## 3. 红线（改这块时绝对不要碰）

- `packages/services/src/model-provider/`（`providerConfigRuntime.ts`、`providerFacadeServices.ts`）
  —— 第三方模型接入通道，核心功能
- `config/provider/zcode-builtin.json` 里的**第三方 16 条模板**（Moonshot / MiniMax / DeepSeek / Qwen /
  MiMo / OpenAI / Anthropic / xAI / OpenRouter / OpenCode）
- `packages/provider/src/config/` 下的配置 schema 与 overlay 链（`model-config.ts`、`rule-data-schema.ts`）
- `serializeRegistryModelConfig` 的序列化契约（渲染进程靠它拿数据）
- 用户自己添加的自定义供应商（9Router / CreditOrys / AI Gateway / GO / Nimbus / AMD / GOTA / StepFun 等）
  —— 这些是**要保留的能力**

---

## 4. 决策记录

| 日期 | 决定 | 备注 |
|---|---|---|
| 2026-09-23 | 本轮**先不做**，只记文档 | 用户：「那这个先不做你在项目里写一个文档待办」 |
| 2026-09-23 | **选方案 B，但等 baseUrl** | 用户明确：内置供应商的「架子」要留着，将来连的是自有服务器。拿到中转站地址后：把智谱系 4 条模板改写成 Polaris 自有模板，左侧「内置供应商」栏位随之恢复 |

## 5. 与「内置供应商栏位」现状的关系（2026-09-23 核实）

左侧导航的「内置供应商」分组来自 `PRESET_PROVIDER_SPECS`（`ui/src/settings/model-provider-section/constants.ts`），
**上游只有 2 项**：`Z.ai` 与 `BigModel` 的 Start Plan，且都绑官方 OAuth
（`oauthProviderId` 指向官方渠道）。砍 OAuth 那一轮（提交 `3af70d7`）它们一起被清空，
所以该分组现在是空的、整组隐藏。

**没有被动过的是模板**：`config/provider/zcode-builtin.json` 里 20 条内置模板全在
（智谱系 4 条 + 第三方 16 条），入口是「设置 → 添加供应商 → 选模板」，可以正常使用。

方案 B 落地时要动的是 `PRESET_PROVIDER_SPECS` 与智谱系模板的 `baseUrl`，不是模板清单本身。
