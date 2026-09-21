# Polaris 瘦身清单（第二轮·修正版）

> **原则（用户 2026-09-22 明确）**：上报、反馈这类**能力要保留**（将来接自己的后端）；要砍的是 **ZCode 特有的东西**——官方域名、官方服务绑定、官方专属业务。

## 身份

| 项 | 值 |
|---|---|
| 产品 | Polaris（`com.bitlesu.polaris`） |
| 自有域名 | `polaris.bitlesu.com` |
| 数据目录 | `~/.polaris` |

## 正确的心智模型

```
保留：能力（framework / interface / UI 入口）
砍掉：ZCode 专属的实现与端点（z.ai、bigmodel、cdn-zcode、discord、feishu、阿里云 ARM）
替代：改指自有域名，或默认关闭 + 可配置
```

## A. 外链域名（14 文件）——一律改指或删除

| 位置 | 现状 | 处置 |
|---|---|---|
| `ui/lib/productDocs.ts:2` | `https://zcode.z.ai/docs` | 改指 `https://polaris.bitlesu.com/docs` |
| `ui/v4/featureSuggestedPrompts.ts:11` | `https://cdn-zcode.z.ai/...` 素材 | **本地化**（素材内置，或改指自有 CDN） |
| `web/auth/webZaiOAuthConfig.ts` | `chat.z.ai/api/oauth/authorize` | **删文件**（OAuth 已砍，无调用方） |
| `web/share/ConversationShareLandingPage.tsx:91` | `ZCODE_DOWNLOAD_URL = "https://zcode.z.ai"` | 改指 `https://polaris.bitlesu.com` |
| `services/conversation-share/conversationShareService.ts:721` | 兜底 `zcode.z.ai/cn/share` | 改指自有域名 |
| 社群链接（discord/feishu） | 官方社群 | **隐藏入口**（`canOpenCommunity` 恒 false）——域名不可达，留着是坏体验 |
| `config/*.env.example` | 官方地址参考 | **保留**（配置示例，不是运行时请求） |
| `config/provider/zcode-builtin.json` | 各厂商 baseUrl | **保留**（模型选择列表，红线） |

## B. 监控/上报——**能力保留，端点改指或默认关闭**

| 模块 | 处置 |
|---|---|
| ARM/RUM（阿里云 SDK `@arms/rum-electron`） | **默认关闭**（这是 ZCode 绑定的厂商，不是通用能力）；保留代码结构以便将来接自己的监控。关键：不再向阿里云发送 |
| 第一方 telemetry（80 文件） | **保留框架**，发送端点改为可配置（默认关闭/指向自有），不再发官方 |
| crashCapture 崩溃上报 | **保留本地存档**，远程上报默认关闭 |
| resource/network sampling（10s/60s 周期） | **保留能力，默认关闭定时上报**（纯监控用途，无用户价值） |

**注意**：不是删代码，是**断官方端点 + 默认关闭**。能力留在代码里，将来接自有后端只需配端点。

## C. 反馈/上报（用户要的能力）——保留，改指自有

| 模块 | 处置 |
|---|---|
| `ui/feedback/`（问题上报、给产品提需求） | **完整保留**；提交端点改指自有（`polaris.bitlesu.com`），不再发官方 |
| `ui/quickpick/quickPickCommands.ts` 的 `feedback` 命令 | 保留 |
| 工单/反馈列表查询 | 保留，端点可配置 |

## D. 保留清单（本地能力，别碰）

- 资源管理器（本地占用扫描）
- 日志导出
- 检查更新（改指自有更新源；若暂无更新源则保留 UI + 默认不自动检查）
- 关于 Polaris
- 会话、工作区、provider 配置、模型选择

## 红线

1. **provider 抽象层不碰**、**provider 内置模板保留**（第三方模型通道）
2. **数据目录改造不碰**、**品牌文件不碰**
3. **能力保留、端点改指/关闭**——不删框架代码（除了纯官方专属如 OAuth 适配器）
4. 禁 git commit、禁改 `*.md`（本文件除外）
5. **禁跑 `build:bootstrap`**（多代理并行，构建由主会话统一做）；只跑类型检查

## 验收

1. 源码里不再有**主动向官方域名发请求**的代码（provider 模板、env 示例、注释除外）
2. 启动日志不再出现「向阿里云/官方上报」
3. 应用能起、能配 API key、能建会话
4. 反馈入口仍在（但不再发官方）
5. 类型检查零错误
