#!/usr/bin/env node
// 官方插件市场 id 改名迁移：zcode-plugins-official → polaris-plugins-official。
//
// 处理对象（全部在 Polaris 数据根内，默认 ~/.polaris）：
//   - known_marketplaces.json / installed_plugins.json / cli/config.json 中的 id、name、
//     enabledPlugins 键、installPath；
//   - marketplaces/<id>/、cache/<id>/、data/<plugin>@<id>/ 目录改名；
//   - 市场分片文件（bundled/cdn/merged）里的 name 字段。
//
// 用法：node scripts/polaris-migrate-official-plugin-marketplace.mjs [--root <数据根>] [--apply]
// 默认 dry-run，只打印计划；--apply 才落盘。幂等：没有旧名残留时无事可做。
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

const OLD_ID = "zcode-plugins-official";
const NEW_ID = "polaris-plugins-official";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? args[rootIndex + 1] : join(homedir(), ".polaris");
if (!root || !existsSync(root)) {
  console.error(`[migrate] data root not found: ${root}`);
  process.exit(2);
}

let planned = 0;
const plan = (message, mutate) => {
  planned += 1;
  if (!apply) {
    console.log(`[dry-run] ${message}`);
    return;
  }
  mutate();
  console.log(`[applied] ${message}`);
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const pluginsRoot = join(root, "cli", "plugins");

// 1) known_marketplaces.json：id / name
const knownPath = join(pluginsRoot, "known_marketplaces.json");
const known = readJson(knownPath);
if (known && Array.isArray(known.marketplaces)) {
  let changed = false;
  for (const record of known.marketplaces) {
    if (record?.id === OLD_ID) {
      record.id = NEW_ID;
      changed = true;
    }
    if (record?.name === OLD_ID) {
      record.name = NEW_ID;
      changed = true;
    }
  }
  if (changed) plan(`rewrite ${knownPath}`, () => writeJson(knownPath, known));
}

// 2) installed_plugins.json：id / marketplace / installPath
const installedPath = join(pluginsRoot, "installed_plugins.json");
const installed = readJson(installedPath);
if (installed && Array.isArray(installed.plugins)) {
  let changed = false;
  for (const record of installed.plugins) {
    if (typeof record?.id === "string" && record.id.endsWith(`@${OLD_ID}`)) {
      record.id = `${record.id.slice(0, -OLD_ID.length)}${NEW_ID}`;
      changed = true;
    }
    if (record?.marketplace === OLD_ID) {
      record.marketplace = NEW_ID;
      changed = true;
    }
    if (
      typeof record?.installPath === "string" &&
      record.installPath.includes(`${sep}${OLD_ID}${sep}`)
    ) {
      record.installPath = record.installPath
        .split(`${sep}${OLD_ID}${sep}`)
        .join(`${sep}${NEW_ID}${sep}`);
      changed = true;
    }
  }
  if (changed) plan(`rewrite ${installedPath}`, () => writeJson(installedPath, installed));
}

// 3) cli/config.json：enabledPlugins 键
const configPath = join(root, "cli", "config.json");
const config = readJson(configPath);
if (config && typeof config.plugins === "object" && config.plugins !== null) {
  const enabledPlugins = config.plugins.enabledPlugins;
  if (enabledPlugins && typeof enabledPlugins === "object") {
    let changed = false;
    const next = {};
    for (const [key, value] of Object.entries(enabledPlugins)) {
      if (key.endsWith(`@${OLD_ID}`)) {
        next[`${key.slice(0, -OLD_ID.length)}${NEW_ID}`] = value;
        changed = true;
      } else {
        next[key] = value;
      }
    }
    if (changed) {
      plan(`rewrite ${configPath} (enabledPlugins keys)`, () => {
        config.plugins.enabledPlugins = next;
        writeJson(configPath, config);
      });
    }
  }
}

// 4) 目录改名：marketplaces/<id>、cache/<id>、data/<plugin>@<id>
const renamePairs = [
  [join(pluginsRoot, "marketplaces", OLD_ID), join(pluginsRoot, "marketplaces", NEW_ID)],
  [join(pluginsRoot, "cache", OLD_ID), join(pluginsRoot, "cache", NEW_ID)],
];
const dataRoot = join(pluginsRoot, "data");
if (existsSync(dataRoot)) {
  for (const entry of readdirSync(dataRoot)) {
    if (entry.endsWith(`@${OLD_ID}`)) {
      renamePairs.push([
        join(dataRoot, entry),
        join(dataRoot, `${entry.slice(0, -OLD_ID.length)}${NEW_ID}`),
      ]);
    }
  }
}
for (const [from, to] of renamePairs) {
  if (!existsSync(from)) continue;
  if (existsSync(to)) {
    console.warn(`[migrate] skip: target already exists for ${from} (manual merge needed)`);
    continue;
  }
  plan(`rename ${from} → ${to}`, () => renameSync(from, to));
}

// 5) 市场分片文件的 name 字段（目录改名后在新目录下）
const marketplaceDir = join(pluginsRoot, "marketplaces", NEW_ID);
for (const file of ["bundled-marketplace.json", "cdn-marketplace.json", "marketplace.json"]) {
  const filePath = join(marketplaceDir, file);
  const value = readJson(filePath);
  if (!value) continue;
  let changed = false;
  if (value.manifest && value.manifest.name === OLD_ID) {
    value.manifest.name = NEW_ID;
    changed = true;
  }
  if (value.name === OLD_ID) {
    value.name = NEW_ID;
    changed = true;
  }
  // 插件条目里的绝对 cachePath 也指向 cache/<旧 id>/… —— 一并改写，否则
  // 内置根校验（cache/<marketplaceId>/<name> 的 descendant 检查）会丢弃这些插件。
  // 分片形态：bundled 是 {manifest:{plugins}}，cdn/merged 是顶层 {plugins}。
  const pluginLists = [value.plugins, value.manifest?.plugins].filter(Array.isArray);
  for (const plugins of pluginLists) {
    for (const plugin of plugins) {
      if (
        typeof plugin?.cachePath === "string" &&
        plugin.cachePath.includes(`${sep}${OLD_ID}${sep}`)
      ) {
        plugin.cachePath = plugin.cachePath
          .split(`${sep}${OLD_ID}${sep}`)
          .join(`${sep}${NEW_ID}${sep}`);
        changed = true;
      }
    }
  }
  if (changed) plan(`rewrite ${filePath} (name → ${NEW_ID})`, () => writeJson(filePath, value));
}

console.log(
  `[migrate] ${apply ? "applied" : "dry-run"}: ${planned} action(s) for ${root}` +
    (apply ? "" : " — re-run with --apply to execute"),
);
