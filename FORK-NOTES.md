# ZCode fork 工作流（企业定制）

> 本仓库是 `zai-org/ZCode` 的 fork（`PumpkinTTL/ZCode`），用途：企业定制版。

## 仓库与分支

```
remote:
  origin   = https://github.com/PumpkinTTL/ZCode.git   （我们的 fork，可推）
  upstream = https://github.com/zai-org/ZCode.git      （官方，只读）

分支:
  main       = 上游镜像。只接收官方更新，永远不直接改
  enterprise = 全部定制。日常开发都在这
```

## 日常开发

```bash
cd D:/DevelopmentProject/ZCode-fork
git checkout enterprise
# 改代码、提交、推送
git add -A && git commit -m "feat(...): ..."
git push origin enterprise
```

## 同步官方更新

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout enterprise && git merge main
# 冲突只会出现在我们改过的文件上，按 commit 逐个归因解决
```

## 本地初始化（新机器/重装依赖）

```bash
npm i -g corepack && corepack enable      # 或用 npx 指定版本
npx -y pnpm@10.33.2 install               # 装依赖（约 6 分钟）
npx -y pnpm@10.33.2 run build:bootstrap   # 一次性构建全部 workspace 包（必需）
npx -y pnpm@10.33.2 run dev:desktop       # 起桌面开发版
npx -y pnpm@10.33.2 run dev:web           # 起 Web 开发版（前端 5173/后端 3030）
```

**注意（上游 bug，勿踩）**：`pnpm dev:web` 在 Windows 上会失败，因为 `packages/server/package.json` 的 dev 脚本用了 POSIX 单引号：
`tsup --watch --onSuccess 'node dist/entry-http.js'`。cmd 会把引号带进文件名 → "Cannot find dist/entry-http.js'"。
绕法：直接 `node packages/server/dist/entry-http.js` + 单独 `vite`（见 dev:desktop 的用法）。

## 定制原则（与 Taurus 项目一致）

1. **核心功能不动**：Agent 运行时、工具链、provider 抽象层、插件系统——照搬上游
2. **品牌层**：产品名/logo/文案，集中在少数文件，可脚本替换
3. **业务层**：官方账号入口（z.ai/Coding Plan/余额页）是可砍的 UI 入口；
   **provider 抽象层不能砍**——它正是第三方模型能接进来的地方
4. **不克隆业务组件**：上游活跃迭代的组件只改样式/外挂，避免手工重移植

## 模型接入

- **不登录账号也能用**：provider 的 `api-key` 通道与官方 OAuth 登录完全独立
- 内置 20 条 provider 模板（见 `config/provider/zcode-builtin.json`），覆盖三类协议：
  `anthropic-messages` / `openai-chat-completions` / `openai-responses`
- **接自己的中转站**：在模板里加一条，`baseUrl` 指向自己的地址，协议二选一，配 `builtinModelIds`
- 登录命令 `zcode login zai|bigmodel` 只服务官方套餐用户，企业版可整体不用
