import { rm } from "node:fs/promises";
import process from "node:process";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpawnRuntimeOptions } from "../../../scripts/spawn-command.mjs";

export function resolveDesktopBuildCwd() {
  // tsup / vite 配置里的入口路径都是相对 desktop 包根目录声明的。
  // 之前默认 cwd 落在 scripts 子目录，Windows CI 上会把 src/main/index.ts 解析成 scripts/src/... 直接报找不到入口。
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveDesktopProductionCleanPaths(cwd) {
  return [
    resolve(cwd, "out/main"),
    resolve(cwd, "out/host"),
    resolve(cwd, "out/preload"),
    resolve(cwd, "out/renderer"),
    resolve(cwd, "out/plugin-sandbox"),
    // scheduler 与 host 同为常驻进程、同为 tsup 多 entry 输出且共用 out/**/* 打包 glob：
    // 漏掉它会让上一代的 orphan chunk 与 sourcemap 一直留在 out 里被 electron-builder 打进 app.asar
    // （实测 out/scheduler 里残留过 3 天前的 chunk 与旧代码的 sourcemap）。
    resolve(cwd, "out/scheduler"),
    resolve(cwd, "out/extension-host"),
    resolve(cwd, "out/.main-build-ready"),
    resolve(cwd, "out/.host-build-ready"),
    resolve(cwd, "out/.preload-build-ready"),
    resolve(cwd, "out/.extension-host-build-ready"),
  ];
}

export async function cleanDesktopProductionOutput({ cwd }) {
  if (process.env.ZCODE_E2E_KEEP_BUILD_CACHE === "1") {
    console.log("[build] ZCODE_E2E_KEEP_BUILD_CACHE=1, skipping clean");
    return;
  }
  // 生产构建之前如果已有开发态/旧生产态 out，tsup 不会主动删除过期 chunk。
  // 这些旧文件会继续被 electron-builder 的 out/**/* 打进 app.asar，重新暴露未压缩 JS 和 sourcemap 尾注。
  await Promise.all(
    resolveDesktopProductionCleanPaths(cwd).map((targetPath) =>
      rm(targetPath, { force: true, recursive: true }),
    ),
  );
}

export function createDesktopProductionBuildPlan({ cwd, baseEnv = process.env }) {
  const env = {
    ...baseEnv,
    NODE_ENV: "production",
  };

  return [
    {
      label: "desktop production bundles",
      parallel: [
        {
          command: "pnpm",
          args: ["exec", "tsup"],
          cwd,
          env,
        },
        {
          command: "pnpm",
          args: ["exec", "vite", "build"],
          cwd,
          env,
        },
      ],
    },
  ];
}

function runCommandAsync(step) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: step.env,
      stdio: "inherit",
      ...resolveSpawnRuntimeOptions(step.command),
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      const reason = signal ? `signal ${signal}` : `code ${code}`;
      rejectRun(new Error(`${step.command} ${step.args.join(" ")} failed with ${reason}`));
    });
  });
}

export async function runDesktopProductionBuild({ cwd = resolveDesktopBuildCwd() } = {}) {
  await cleanDesktopProductionOutput({ cwd });
  for (const step of createDesktopProductionBuildPlan({ cwd })) {
    if (step.parallel) {
      // 之前串行跑 tsup 和 vite，但两者分别写 main/preload/host 与 renderer 目录。
      // 这里并行执行平台无关构建，缩短 CI 关键路径，同时保持各自 cwd/env 一致以兼容 macOS/Windows/Linux runner。
      await Promise.all(step.parallel.map(runCommandAsync));
      continue;
    }

    await runCommandAsync(step);
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  await runDesktopProductionBuild();
}
