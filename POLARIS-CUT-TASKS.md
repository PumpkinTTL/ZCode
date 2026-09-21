# Polaris 业务砍除施工契约

> 三档推进，每档独立验证。**核心红线：第三方 API key 通道必须始终可用。**

## 已完成的品牌/目录改造（勿重复）

- 产品身份：Polaris（`com.bitlesu.polaris`），见 `packages/desktop/scripts/desktop-product-identity.mjs`
- 数据目录：`~/.polaris`（真值 `packages/services/src/paths.ts` 的 `DATA_ROOT_DIR_NAME`）
- **不做旧目录迁移**（上游的 `copyDataDirectory` 保留原样，那是用户改数据目录时的功能）
- 已删 5 个 UI 文件：`StartPlanContextBalance.tsx`、`useOAuth.ts`、`accountConnectionLossSuggestion.ts`、`accountConnectionRefreshObserver.ts`、`useAccountConnectionLossNotification.ts`

## 审计结论（已核实，照此执行）

| 模块 | 引用情况 | 处置 |
|---|---|---|
| UI 层官方账号入口 | `packages/ui/src/login/`、`components/coding-plan-quota-reset/` | **整体删除** |
| `oauth/providers/`（zai/bigmodel 适配器） | 只被 oauth 内部引用 | **删除适配器，保留接口** |
| `oauth/`（`oauth.ts` 接口等） | `accessor.ts:16,64` 声明服务、`feedbackService` 引类型 | **保留接口定义**，实现体按需精简 |
| `coding-plan-subscription/`（4 文件） | `accessor.ts:22,70`、`node.ts:208,397`、`zcodeAgentService:20` 用 `OffPeakClientConfig` 类型 | **保留接口 + 类型**，实现可空壳化 |
| `model-provider/accountProvider*`（11 文件） | 需逐个验证，部分被通用链路引用 | **甄别后处理** |

## 三档执行

### 第一档：UI 层（零风险）
删除所有面向用户的官方账号界面：
- `packages/ui/src/login/`（2 文件）
- `packages/ui/src/components/coding-plan-quota-reset/`（5 文件）
- i18n 里对应的文案 key（保留 key 不删也行，但界面不引用）
- 任何仍在引用这些组件的调用点：**删调用，不删被引用的核心服务**

验证：`build:bootstrap` 通过 + 起应用截图（设置页无官方账号入口）

### 第二档：OAuth 适配器（低风险）
- 删除 `packages/services/src/oauth/providers/`（zai/bigmodel 适配器）
- 保留 `oauth.ts` 接口、`repo/`（凭据仓库是通用能力）
- 处理 `oauthService.ts`：让它只保留接口实现骨架，不引用已删的适配器
- 检查 `feedbackService` 对 `IOAuthService` 的引用（只引类型，应无碍）

验证：构建通过 + 起应用可用

### 第三档：计费服务（需谨慎）
- `coding-plan-subscription/` 保留**接口 + 类型定义**（`codingPlanSubscription.ts` 的 `ICodingPlanSubscriptionService`、`OffPeakClientConfig`）
- 删除 zai/bigmodel 的具体实现（`zaiCodingPlanSubscriptionProvider.ts`、`bigmodelCodingPlanSubscriptionProvider.ts`）
- `codingPlanSubscriptionService.ts` 改为**空实现**（所有方法返回空/undefined，不抛错）
- 理由：`zcodeAgentService` 依赖 `OffPeakClientConfig` 类型；将来接自己的套餐时只实现接口

验证：构建通过 + 起应用 + agent 能正常创建会话

## 每个代理的共同红线

1. **禁碰**：`packages/services/src/model-provider/providerConfigRuntime.ts`、`providerFacadeServices.ts`（provider 抽象层，第三方模型的通道）
2. **禁碰**：`packages/services/src/paths.ts`、`packages/desktop/src/main/desktopDataBaseDirBootstrap.ts`（数据目录改造，已完成）
3. **禁碰**：`packages/ui/src/components/ui/PolarisAboutLogo.tsx`、i18n 品牌文案（品牌改造，已完成）
4. 删文件后**必须清理所有引用**（`grep` 确认零残留），否则构建必挂
5. 每档做完必须：`npx -y pnpm@10.33.2 run build:bootstrap` 通过
6. 起应用验证用：`powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','chcp 65001 >nul && cd /d D:\DevelopmentProject\ZCode-fork && npx -y pnpm@10.33.2 run dev:desktop' -WorkingDirectory 'D:\DevelopmentProject\ZCode-fork'"`
   （**不要用 bash 后台方式**，父进程退出会带走子进程；起前先 taskkill 标题含 Polaris 的 electron）
7. 禁 git commit（工作树留给主会话）
8. 禁改 `*.md`（除本文件）

## 验收标准

1. 应用能起、能创建会话、能配 API key 用第三方模型
2. 设置页看不到官方登录/套餐/余额入口
3. 代码里不再有 zai/bigmodel 的业务实现（接口与类型除外）
4. 构建零错误
