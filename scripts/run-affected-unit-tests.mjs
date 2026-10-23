#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createVitest } from "vitest/node";
import { git, cleanGitEnv } from "./affected-unit-tests/process.mjs";
import { resolveScope } from "./affected-unit-tests/scope.mjs";

<<<<<<< HEAD
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { selectDefaultBranchRef } from "./affected-unit-test-baseline.mjs";

const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const CHANGED_DIFF_FILTER = "ACMRTUXB";
const ZERO_SHA = /^0{40}$/u;

function resolvePnpmCliPath(env) {
  const npmExecPath = env.npm_execpath;
  if (
    npmExecPath &&
    (npmExecPath.toLowerCase().includes("\\pnpm\\") ||
      npmExecPath.toLowerCase().includes("/pnpm/"))
  ) {
    return npmExecPath;
=======
export async function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--scope" || arg === "--base") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要参数`);
      options[arg.slice(2)] = value;
    } else if (arg === "--files") {
      options.files ??= [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) options.files.push(argv[++i]);
      if (!options.files.length) throw new Error("--files 需要文件清单");
    } else if (arg === "--files-manifest") {
      const manifest = argv[++i];
      if (!manifest) throw new Error("--files-manifest 需要路径");
      const parsed = JSON.parse(await readFile(manifest, "utf8"));
      if (
        !Array.isArray(parsed.files) ||
        !parsed.files.length ||
        !parsed.files.every((file) => typeof file === "string" && file)
      )
        throw new Error("文件清单无效");
      options.files = [...(options.files ?? []), ...parsed.files];
    } else throw new Error(`未知参数：${arg}`);
>>>>>>> upstream/main
  }
  return options;
}

<<<<<<< HEAD
function run(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  };

  if (process.platform === "win32" && command === "pnpm") {
    // Bugfix: Windows pre-push runner 需要保持 lint-staged 传入的文件 argv 原样。
    // 只在本脚本内绕过 cmd shim，避免影响 bootstrap/build 共享命令入口。
    const cliPath = resolvePnpmCliPath(options.env ?? process.env);
    if (cliPath) {
      return spawnSync(process.execPath, [cliPath, ...args], spawnOptions);
    }
    return spawnSync("pnpm", args, { ...spawnOptions, shell: true });
  }

  return spawnSync(command, args, spawnOptions);
}

function runGit(args, options = {}) {
  const result = run("git", args, options);
  if (result.status !== 0 && options.required !== false) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.status === 0 ? result.stdout.trim() : "";
}

function print(message) {
  console.log(`[pre-push affected tests] ${message}`);
}

function hasCommit(root, ref) {
  if (!ref) {
    return false;
  }
  const result = runGit(["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    required: false,
  });
  return Boolean(result);
}

function isZeroSha(value) {
  return ZERO_SHA.test(value);
}

function parsePrePushInput(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/u);
      if (!localRef || !localSha || !remoteRef || !remoteSha) {
        return undefined;
      }
      return { localRef, localSha, remoteRef, remoteSha };
    })
    .filter(Boolean);
}

function resolveDefaultBranchBase(root) {
  const originHead = runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    cwd: root,
    required: false,
  });

  const ref = selectDefaultBranchRef({
    originHead,
    hasCommit: (candidate) => hasCommit(root, candidate),
  });

  if (!ref) {
    return undefined;
  }

  return {
    base: ref,
    head: "HEAD",
    label: `default branch ${ref}`,
    useMergeBase: true,
  };
}

function resolvePrePushTarget(root) {
  const entries = parsePrePushInput(process.env.ZCODE_PRE_PUSH_STDIN ?? "");
  if (entries.length === 0) {
    return undefined;
  }

  const headSha = runGit(["rev-parse", "HEAD"], { cwd: root });
  const currentRef = runGit(["symbolic-ref", "--quiet", "HEAD"], {
    cwd: root,
    required: false,
  });
  const candidate =
    entries.find((entry) => entry.localSha === headSha && !isZeroSha(entry.localSha)) ??
    entries.find((entry) => entry.localRef === currentRef && !isZeroSha(entry.localSha)) ??
    entries.find((entry) => !isZeroSha(entry.localSha));

  if (!candidate) {
    return undefined;
  }

  if (isZeroSha(candidate.remoteSha)) {
    print(`${candidate.remoteRef} 是新建远端分支，pre-push stdin 没有可比较的 remote sha。`);
    return undefined;
  }

  if (!hasCommit(root, candidate.remoteSha) || !hasCommit(root, candidate.localSha)) {
    return undefined;
  }

  return {
    base: candidate.remoteSha,
    head: candidate.localSha,
    label: `pre-push remote ${candidate.remoteRef}`,
    useMergeBase: false,
  };
}

function resolveUpstreamTarget(root) {
  const upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], {
    cwd: root,
    required: false,
  });

  if (!hasCommit(root, upstream)) {
    return undefined;
  }

  return {
    base: upstream,
    head: "HEAD",
    label: `upstream ${upstream}`,
    useMergeBase: false,
  };
}

function resolveDiffTarget(root) {
  const explicitBase =
    process.env.ZCODE_PRE_PUSH_BASE?.trim() || process.env.ZCODE_AFFECTED_TEST_BASE?.trim();
  if (explicitBase) {
    if (!hasCommit(root, explicitBase)) {
      throw new Error(`显式 base 不存在或不是 commit: ${explicitBase}`);
    }
    return {
      base: explicitBase,
      head: "HEAD",
      label: `explicit base ${explicitBase}`,
      useMergeBase: true,
    };
  }

  return (
    resolvePrePushTarget(root) ?? resolveUpstreamTarget(root) ?? resolveDefaultBranchBase(root)
  );
}

function extensionOf(file) {
  const match = file.match(/(\.[^./]+)$/u);
  return match?.[1] ?? "";
}

function isRootUnitTestFile(file) {
  return (
    /^packages\/[^/]+\/test\/.*\.test\.ts$/u.test(file) &&
    !file.startsWith("packages/desktop/test/e2e/")
  );
}

function isCodeLikeFile(file) {
  return CODE_EXTENSIONS.has(extensionOf(file));
}

function isRootVitestScope(file) {
  return file.startsWith("packages/") && !file.startsWith("packages/desktop/test/e2e/");
}

function collectPaths(value) {
  return value.split("\0").filter(Boolean);
}

function runFullUnitTests(root, reason) {
  print(`${reason}，执行全量 pnpm run test:unit。`);
  return (
    run("pnpm", ["run", "test:unit"], {
      cwd: root,
      stdio: "inherit",
    }).status ?? 1
  );
}

function runChangedVitest(root, mode, files) {
  if (files.length === 0) {
    return 0;
  }

  // Polaris：上游 v3.15.1 把 affected 流改成经 lint-staged 分发（`pnpm exec lint-staged
  // --diff ...`），但本仓在 7b9a01cf 已按「零调用方」瘦掉该依赖——合并后 pre-push 的
  // affected 路径实际是坏的（此前靠「diff 含删除文件 → 回退全量」侥幸绕过）。
  // 这里不再装回依赖，直接按 lint-staged.config.mjs 原本的两条映射调用其底层 runner：
  // 测试文件 → vitest run；源文件 → vitest related。文件清单走 manifest，无 shell 拼接。
  const manifestDir = mkdtempSync(join(tmpdir(), "zcode-affected-vitest-"));
  const manifestPath = join(manifestDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ mode, files }));
=======
const specKey = (spec) => JSON.stringify([spec.project.name, spec.pool, spec.moduleId]);
>>>>>>> upstream/main

export async function main(argv = process.argv.slice(2)) {
  let vitest;
  const restored = {};
  try {
<<<<<<< HEAD
    print(`执行 node scripts/run-lint-staged-vitest.mjs ${mode}（${files.length} 个文件）`);
    return (
      run(
        "node",
        ["scripts/run-lint-staged-vitest.mjs", mode, "--files-manifest", manifestPath],
        { cwd: root, stdio: "inherit" },
      ).status ?? 1
    );
  } finally {
    rmSync(manifestDir, { force: true, recursive: true });
  }
}

function main() {
  const root = runGit(["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
  });

  const target = resolveDiffTarget(root);
  if (!target) {
    return runFullUnitTests(root, "未找到可用于比较的 upstream 或默认 base");
  }

  const comparisonBase = target.useMergeBase
    ? runGit(["merge-base", target.base, target.head], { cwd: root })
    : target.base;
  print(`使用 ${target.label} 计算 affected 范围：${comparisonBase}..${target.head}`);

  const changedFiles = collectPaths(
    runGit(
      [
        "diff",
        "--name-only",
        "-z",
        `--diff-filter=${CHANGED_DIFF_FILTER}`,
        comparisonBase,
        target.head,
      ],
      { cwd: root },
    ),
  );
  const deletedFiles = collectPaths(
    runGit(["diff", "--name-only", "-z", "--diff-filter=D", comparisonBase, target.head], {
      cwd: root,
    }),
  );

  if (changedFiles.length === 0 && deletedFiles.length === 0) {
    print(`当前 ${target.head} 相对 ${comparisonBase} 没有变更，跳过 Vitest 单测。`);
    return 0;
  }

  const deletedCodeFile = deletedFiles.find(
    (file) => isRootVitestScope(file) && isCodeLikeFile(file),
  );
  if (deletedCodeFile) {
    return runFullUnitTests(root, `${deletedCodeFile} 已删除，无法交给 vitest related 分析`);
  }

  const existingFiles = changedFiles.filter((file) => existsSync(resolve(root, file)));
  const testFiles = existingFiles.filter(isRootUnitTestFile);
  const relatedSourceFiles = existingFiles.filter(
    (file) => isRootVitestScope(file) && isCodeLikeFile(file) && !isRootUnitTestFile(file),
  );

  if (testFiles.length === 0 && relatedSourceFiles.length === 0) {
    print("没有影响根 Vitest 单测范围的 JS/TS/JSON 文件，跳过 Vitest 单测。");
    return 0;
  }

  const testsExit = runChangedVitest(root, "run", testFiles);
  if (testsExit !== 0) {
    return testsExit;
  }
  return runChangedVitest(root, "related", relatedSourceFiles);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(
    `[pre-push affected tests] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
=======
    const options = await parseArgs(argv);
    if (options.help) {
      console.log(
        "用法：pnpm test:unit:affected [--scope worktree|push] [--base <commit>] [--files <files...>] [--dry-run] [--json]\n使用 Vitest 官方选择；全量选择跳过 UT 并成功退出，脏工作区 Push 和错误非零退出。0=通过/无选中测试/跳过全量，1=测试失败，2=阻止执行/脚本错误。",
      );
      return 0;
    }
    const root = (await git(process.cwd(), ["rev-parse", "--show-toplevel"])).toString().trim();
    const env = await cleanGitEnv(root);
    // hook 的临时 index 不能污染官方 Git 选择及测试中的临时仓库。
    for (const key of Object.keys(process.env)) {
      if (!(key in env)) {
        restored[key] = process.env[key];
        delete process.env[key];
      }
    }
    const scope = await resolveScope(root, options, env);
    const selected = new Map();
    const related = new Set();
    let all = [];
    if (!scope.deletedOnly) {
      vitest = await createVitest(
        "test",
        { root, watch: false, run: true, reporters: ["default"], silent: "passed-only" },
        { server: { watch: null } },
      );
      all = await vitest.globTestSpecifications();
      for (const base of scope.bases) {
        vitest.config.changed = scope.files ? false : base;
        vitest.config.related = scope.files;
        for (const spec of await vitest.getRelevantTestSpecifications())
          selected.set(specKey(spec), spec);
        for (const file of vitest.config.related ?? []) related.add(file);
      }
    }
    const specs = [...selected.values()].sort((a, b) => specKey(a).localeCompare(specKey(b)));
    const tests = specs.map((spec) => ({
      runner: "vitest",
      project: spec.project.name,
      pool: spec.pool,
      path: relative(root, spec.moduleId).replaceAll("\\", "/"),
    }));
    if (options.json) console.log(JSON.stringify(tests, null, 2));
    else {
      console.log(
        `[affected] base=${scope.files ? "related" : scope.bases.map((base) => (base === true ? "HEAD（未提交）" : base)).join(",")} 选中 ${specs.length}/${all.length}${specs.length ? "" : "：无选中测试"}`,
      );
      if (options.dryRun)
        for (const test of tests) console.log(`  ${test.project}/${test.pool}: ${test.path}`);
    }
    // 全量选择不是测试失败；加载测试前跳过并成功退出，避免仅因不跑全量而阻止 Push。
    if (all.length && all.every((spec) => selected.has(specKey(spec)))) {
      console.warn(
        `[affected] Vitest 官方选择了整个根 UT 套件（${all.length} 个规格），已跳过 UT（未执行测试），不因此阻止 Push。改动文件：${[...related].map((file) => relative(root, file)).join(", ")}`,
      );
      return 0;
    }
    if (!specs.length || options.dryRun) return 0;
    await vitest.standalone();
    const result = await vitest.runTestSpecifications(specs, false);
    return result.unhandledErrors.length ||
      result.testModules.some((module) => module.state() === "failed")
      ? 1
      : 0;
  } catch (error) {
    console.error(`[affected] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    try {
      await vitest?.close();
    } finally {
      Object.assign(process.env, restored);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main();
>>>>>>> upstream/main
