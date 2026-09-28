import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS,
  PLUGIN_MARKETPLACE_MIRRORS_ENV,
  PLUGIN_MARKETPLACE_SOURCES_ENV,
  POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL,
  PRESET_PLUGIN_MARKETPLACES,
  ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL,
  isPresetMarketplaceAdded,
  normalizeMarketplaceSourceForCompare,
  parsePluginMarketplaceSourceList,
  resolveOfficialPluginMarketplaceMirrors,
  resolvePresetPluginMarketplaces,
} from "../src/plugin-marketplaces.js";

test("preset marketplace sources are unique, non-empty, and carry catalog identity", () => {
  const sources = new Set<string>();
  const ids = new Set<string>();
  for (const preset of PRESET_PLUGIN_MARKETPLACES) {
    assert.ok(preset.source.trim().length > 0, preset.id);
    assert.ok(preset.name.trim().length > 0, preset.id);
    assert.ok(preset.description.trim().length > 0, preset.id);
    // 每个预置源都必须带声明名，否则「已添加」判断会退化成脆弱的源串比较。
    assert.ok(preset.catalogName && preset.catalogName.trim().length > 0, preset.id);
    assert.equal(sources.has(preset.source), false, `duplicate source: ${preset.source}`);
    assert.equal(ids.has(preset.id), false, `duplicate id: ${preset.id}`);
    sources.add(preset.source);
    ids.add(preset.id);
  }
});

test("source list parsing trims, splits on comma/newline, dedupes, and drops empties", () => {
  assert.deepEqual(parsePluginMarketplaceSourceList(undefined), []);
  assert.deepEqual(parsePluginMarketplaceSourceList(""), []);
  assert.deepEqual(
    parsePluginMarketplaceSourceList(" my-org/hub ,\n\n  https://git.example.com/x.git ,my-org/hub"),
    ["my-org/hub", "https://git.example.com/x.git"],
  );
});

test("env-injected sources are appended as presets without duplicating built-ins", () => {
  const env = {
    [PLUGIN_MARKETPLACE_SOURCES_ENV]: `my-org/my-hub,${PRESET_PLUGIN_MARKETPLACES[0]?.source}`,
  } as unknown as NodeJS.ProcessEnv;
  const resolved = resolvePresetPluginMarketplaces(env);
  assert.equal(resolved.length, PRESET_PLUGIN_MARKETPLACES.length + 1);
  const injected = resolved.at(-1);
  assert.equal(injected?.source, "my-org/my-hub");
  assert.equal(injected?.name, "my-org/my-hub");
  // 与内置预置同源时保留内置展示信息，不重复追加。
  assert.equal(
    resolved.filter((preset) => preset.source === PRESET_PLUGIN_MARKETPLACES[0]?.source).length,
    1,
  );
});

test("preset resolution stays browser-safe when env is absent", () => {
  const resolved = resolvePresetPluginMarketplaces(undefined);
  assert.ok(resolved.length >= PRESET_PLUGIN_MARKETPLACES.length);
});

test("added-preset detection matches by catalog name and by normalized source", () => {
  const preset = {
    id: "demo",
    source: "anthropics/claude-plugins-official",
    name: "Demo",
    description: "Demo",
    catalogName: "claude-plugins-official",
  };

  // 目录声明名命中。
  assert.equal(
    isPresetMarketplaceAdded(preset, [{ id: "claude-plugins-official", source: {} }]),
    true,
  );
  // 源串归一化命中（协议头 / .git / 大小写 / github.com 前缀都不影响）。
  assert.equal(
    isPresetMarketplaceAdded(preset, [
      {
        id: "renamed-catalog",
        source: { source: "git", url: "HTTPS://GitHub.com/anthropics/claude-plugins-official.git" },
      },
    ]),
    true,
  );
  // 无关源不误判。
  assert.equal(
    isPresetMarketplaceAdded(preset, [
      { id: "other", source: { source: "github", repo: "someone/else" } },
    ]),
    false,
  );
});

test("source normalization is only for comparison, not for fetching", () => {
  assert.equal(
    normalizeMarketplaceSourceForCompare("https://github.com/anthropics/x.git"),
    "anthropics/x",
  );
});

test("official marketplace mirrors default to Polaris first, Z.ai as fallback", () => {
  assert.deepEqual([...OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS], [
    POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL,
    ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL,
  ]);
  assert.deepEqual(resolveOfficialPluginMarketplaceMirrors({} as NodeJS.ProcessEnv), [
    POLARIS_OFFICIAL_PLUGIN_MARKETPLACE_URL,
    ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL,
  ]);
});

test("the mirror env var fully overrides order, so priority is user-settable", () => {
  const onlyZai = resolveOfficialPluginMarketplaceMirrors({
    [PLUGIN_MARKETPLACE_MIRRORS_ENV]: ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL,
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(onlyZai, [ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL]);

  const reversed = resolveOfficialPluginMarketplaceMirrors({
    [PLUGIN_MARKETPLACE_MIRRORS_ENV]: `${ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL},https://mirror.example.com/marketplace.json`,
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(reversed, [
    ZAI_OFFICIAL_PLUGIN_MARKETPLACE_MIRROR_URL,
    "https://mirror.example.com/marketplace.json",
  ]);

  // 空值不覆盖默认顺序。
  assert.deepEqual(
    resolveOfficialPluginMarketplaceMirrors({
      [PLUGIN_MARKETPLACE_MIRRORS_ENV]: "  ",
    } as unknown as NodeJS.ProcessEnv),
    [...OFFICIAL_PLUGIN_MARKETPLACE_MIRRORS],
  );
});
