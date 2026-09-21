# Polaris 改造施工清单

> 本文件是施工契约。三个代理按此清单各自施工，互不重叠。

## 身份定案

| 项 | 值 |
|---|---|
| 产品名 | **Polaris** |
| appId | `com.bitlesu.polaris` |
| 数据目录 | `~/.polaris`（原 `~/.zcode`） |
| 域名 | `polaris.bitlesu.com` |
| 上游 | `zai-org/ZCode`（fork: `PumpkinTTL/ZCode`） |
| 分支 | `enterprise` |

## 已侦察的关键位置

### A. 品牌身份（代理 1 负责）
| 目标 | 位置 |
|---|---|
| 产品名 + appId 真值源 | `packages/desktop/scripts/desktop-product-identity.mjs`（`PRODUCTION_IDENTITY`） |
| 产品名 package.json | `packages/desktop/package.json:85` `"productName": "ZCode"` |
| Logo 组件 | `packages/ui/src/components/ui/ZCodeAboutLogo.tsx`（`ZCodeAboutLogo` + `ZCodeWordmarkLogo`） |
| 启动 logo | `packages/ui/src/root/RootStartupLoading.tsx` → `ZCodeStartupLogoBadge` |
| 侧栏产品名兜底 | `packages/ui/src/WorkspaceSidebarFooter.tsx:67` `return "ZCode"` |
| 窗口标题 | `packages/ui/src/app-shell/WorkspaceShellLayout.tsx:1512` `ZCode / ${path}` |
| 应用图标 | `public/logo/icons/*`、`packages/desktop/build/icon*` |
| i18n 文案 | `packages/ui/src/i18n/locales/zh-CN.ts`（120 处）、`en-US.ts`（123 处） |

### B. 数据目录（代理 2 负责）
| 目标 | 位置 |
|---|---|
| 路径真值 | `packages/services/src/paths.ts:44` `getZCodeDataRootDir()` → `.zcode` |
| 迁移逻辑参考 | `packages/services/src/paths.ts:232-233`（已有 oldDir→newDir 的 cp 模式） |
| 全仓字面量 | 132 个文件含 `.zcode` 路径（含 desktop/server/services/shared） |
| 环境变量 | `ZCODE_DATA_BASE_DIR`（保留原名，避免影响上游合并）；`ZCODE_HOME` |

### C. 业务接口（代理 3 负责）
| 目标 | 位置 | 处理 |
|---|---|---|
| OAuth 登录 | `packages/services/src/oauth/`（独立子树，仅内部互引） | 评估后砍 |
| 官方账号 UI | `packages/ui/src/login/`、`hooks/useOAuth.ts`、`root/oauth*.ts` | 砍入口 |
| 套餐/计费 | `packages/services/src/coding-plan-subscription/`、`model-provider/zaiStartPlanBilling.ts` | 砍 |
| 套餐 UI | `packages/ui/src/components/coding-plan-quota-reset/`、`chat-input-toolbar/StartPlanContextBalance.tsx` | 砍 |
| **provider 抽象层** | `packages/services/src/model-provider/` 主逻辑 | **严禁砍**（第三方模型的接入点） |

## 红线（三个代理共同遵守）

1. **不改 `@zcode/*` 包名**——用户看不见，改了制造无意义冲突
2. **不动 provider 抽象层**——它是第三方模型能接进来的唯一通道
3. **不删逻辑，只删入口**（业务砍除）：UI 入口先隐藏/移除，底层服务保留但不加载
4. 每个代理只改自己领地的文件，**禁 git commit**（工作树留给主会话统一提交）
5. 改完必须自证：能构建（`pnpm run build:bootstrap` 或对应包的 build）+ 应用能起来
6. 禁改 `*.md`（除本清单外）

## 验收标准

1. 窗口标题、侧栏、登录页、启动页显示 **Polaris**
2. 数据写在 `~/.polaris`，不再碰 `~/.zcode`
3. 官方账号入口不可见，但用 API key 配第三方模型仍可用
4. `pnpm run dev:desktop` 能起来
