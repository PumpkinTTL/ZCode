// Agent bundle 的暂存动作：把 apps/zcode-cli/packages/cli/dist/zcode.cjs 放进
// bundled-agents/<平台>/glm，并写 meta。
//
// dev 与打包**必须**用同一份暂存实现。
// 只有打包链（prepare-agent-node-bundle.mjs）会暂存是不够的，dev 链
// （scripts/build-desktop-agent-cli.mjs）不会；而 dev 未打包时的 agent 二进制由
// desktopRuntimeEnv.ts 的 resolveBundledZCodeAgentBinaryPath() 解析，候选**只有**
// bundled-agents/，没有 cli/dist/。于是 dev 一直跑着上一次打包时留下的那份 ——
// 实测陈旧 3 天，任何 agent CLI 侧改动在 dev 里静默不生效，排查时会把「改动没生效」
// 误判成「代码没起作用」。两边共用这一份，dev 与打包不可能再各自漂移。
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const AGENT_BUNDLE_SOURCE_RELATIVE = "apps/zcode-cli/packages/cli/dist/zcode.cjs";

export function resolveAgentBundlePaths({ repoRoot, platformKey }) {
  const glmDir = resolve(repoRoot, "packages", "desktop", "bundled-agents", platformKey, "glm");
  return {
    cliBundlePath: resolve(repoRoot, AGENT_BUNDLE_SOURCE_RELATIVE),
    glmDir,
    stagedBundlePath: resolve(glmDir, "zcode.cjs"),
    stagedMetaPath: resolve(glmDir, ".node-bundle-meta.json"),
  };
}

/**
 * 干净重建 glm 目录再拷贝。清空是刻意的：electron-builder 整目录拷贝
 * bundled-agents/<平台>/glm → resources/glm，本地工作树里上一次构建残留的原生二进制
 * （zcode-agent / zcode-acp 等）和旧 meta 会被一并打进安装包（CI 干净检出不会有，本地会）。
 */
export function stageAgentBundle({ repoRoot, platformKey, log = console.log }) {
  const { cliBundlePath, glmDir, stagedBundlePath, stagedMetaPath } = resolveAgentBundlePaths({
    repoRoot,
    platformKey,
  });
  if (!existsSync(cliBundlePath)) {
    throw new Error(`[stage:agent-bundle] agent bundle 源产物不存在：${cliBundlePath}`);
  }
  rmSync(glmDir, { recursive: true, force: true });
  mkdirSync(glmDir, { recursive: true });
  copyFileSync(cliBundlePath, stagedBundlePath);
  const meta = {
    runtime: "electron-node",
    entry: "zcode.cjs",
    platform: platformKey,
    source: AGENT_BUNDLE_SOURCE_RELATIVE,
  };
  writeFileSync(stagedMetaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  log(`[stage:agent-bundle] staged ${stagedBundlePath}`);
  return { stagedBundlePath, stagedMetaPath };
}

/**
 * 随 CLI 内置的技能包（不是插件）：bootstrap 的 resolveBundledSkillRoots 沿官方插件同款候选目录
 * 在 zcode.cjs 旁找 `packages/bundled-skills` 并原地读取。漏 stage 它，`/workflow` 会展开成
 * 「先加载 dynamic-workflows 技能」而技能文件不存在——模型拿不到脚本写作规则，四个创作工具的
 * 技能门随即以 428 拒绝。
 *
 * dev 与打包共用这一份定义与实现（同 stageAgentBundle 的理由）：dev 链只暂存 zcode.cjs 与官方
 * 插件包时，这个技能包在 dev 下从未存在过，而打包态一直是齐的——「打包能跑、dev 不能跑」。
 */
export const BUNDLED_SKILL_PACK = {
  relativePath: "apps/zcode-cli/packages/bundled-skills",
  requiredPaths: [
    "skills/dynamic-workflows/SKILL.md",
    "skills/dynamic-workflows/patterns.md",
    "skills/dynamic-workflows/examples.md",
  ],
  stagedPath: "packages/bundled-skills",
  topLevelPaths: ["skills"],
};

/** 与官方插件同一套排除项：本地跑过的缓存/虚拟环境不随包分发。 */
const EXCLUDED_BUNDLED_SKILL_PACK_ASSET_NAMES = new Set([
  ".DS_Store",
  ".venv",
  "__pycache__",
  "node_modules",
]);

export function stageBundledSkillPack({ repoRoot, platformKey, log = console.log }) {
  const { glmDir } = resolveAgentBundlePaths({ repoRoot, platformKey });
  const sourceRoot = resolve(repoRoot, BUNDLED_SKILL_PACK.relativePath);
  const targetRoot = resolve(glmDir, BUNDLED_SKILL_PACK.stagedPath);
  // 先清掉上一次的落盘：cpSync 只覆盖不删除，源里被移走的文件会在目标里留成幽灵，
  // 下面的必需资产校验也就失去意义（缺文件时被旧副本救活）。
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  for (const entryName of BUNDLED_SKILL_PACK.topLevelPaths) {
    cpSync(resolve(sourceRoot, entryName), resolve(targetRoot, entryName), {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return !EXCLUDED_BUNDLED_SKILL_PACK_ASSET_NAMES.has(name) && !name.endsWith(".pyc");
      },
    });
  }
  for (const relativePath of BUNDLED_SKILL_PACK.requiredPaths) {
    const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
    if (!existsSync(stagedAssetPath)) {
      throw new Error(
        `[stage:agent-bundle] missing staged bundled skill pack asset: ${stagedAssetPath}`,
      );
    }
  }
  log(`[stage:agent-bundle] staged bundled skill pack ${BUNDLED_SKILL_PACK.stagedPath}`);
  return { stagedSkillPackPath: targetRoot };
}
