import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  ModelConfigRules,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderRegistry,
  ZhipuAccountAccessConfig,
} from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "@zcode/provider-node";
import { describe, expect, it } from "vitest";
import { buildOffPeakModelSelectionView } from "../src/model-provider/offPeakModelSelectionView.js";

// Polaris fork：官方账号体系移除后，内置配置不再声明 `account:*-offpeak-idle-plan`
// （官方计费模板与账号 provider 已砍）。这里用等价的内联 Built-in 夹具验证投影语义：
// 只投影固定隐藏闲时 Provider，且模型能力面沿用 Built-in 声明。
function offPeakBuiltinRelease(): object {
  return {
    schemaVersion: 1,
    revision: 1,
    config: {
      providerConfigRules: {
        templateRules: [],
        providerRules: [
          {
            providerId: "account:zai-offpeak-idle-plan",
            providerName: "Z.AI Idle plan",
            config: {
              group: "zai-family",
              builtinModelIds: ["GLM-5.3", "GLM-5.3-Flash"],
              visibility: "hidden",
              access: { type: "zhipu-account", mode: "off-peak", accountType: "zai" },
              api: { type: "anthropic-messages", baseUrl: "https://off-peak.example.test/anthropic" },
            },
          },
          {
            providerId: "account:bigmodel-offpeak-idle-plan",
            providerName: "BigModel Idle plan",
            config: {
              group: "bigmodel-family",
              builtinModelIds: ["GLM-5.3", "GLM-5.3-Flash"],
              visibility: "hidden",
              access: { type: "zhipu-account", mode: "off-peak", accountType: "bigmodel" },
              api: { type: "anthropic-messages", baseUrl: "https://off-peak.example.test/anthropic" },
            },
          },
        ],
      },
      modelConfigRules: {
        modelRules: [
          {
            // 完整必填字段：Registry 会按 complete schema 校验，缺字段的 provider 不会发布。
            modelMatch: ".*",
            config: {
              enabled: true,
              properties: {
                contextWindow: 1_000_000,
                inputFormat: {
                  supportsText: true,
                  supportsImage: false,
                  supportsVideo: false,
                  supportsAudio: false,
                  supportsPdf: false,
                },
                outputFormat: { supportsText: true },
                supportsToolCall: true,
                supportsJsonSchemaOutput: false,
                supportsNativeWebSearch: false,
                supportsMidConversationSystem: true,
                requiresMfjsToolSchema: false,
              },
              optionSpecs: {
                maxOutputTokens: { max: 128000, map: "{}" },
                reasoningLevel: { values: ["low", "high", "max"], map: "{}" },
              },
            },
          },
          {
            modelMatch: "GLM-5.3-Flash",
            config: {
              properties: {
                inputFormat: { supportsImage: true, supportsVideo: true, supportsPdf: true },
              },
            },
          },
        ],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  };
}

describe("buildOffPeakModelSelectionView", () => {
  it("只投影 Registry 中固定的隐藏闲时 Provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-off-peak-view-"));
    const builtinFilePath = join(root, "zcode-builtin.json");
    await writeFile(builtinFilePath, JSON.stringify(offPeakBuiltinRelease()), "utf8");
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: builtinFilePath,
      watch: false,
    });
    try {
      const zcodeBuiltin = await source.read();
      const resolution = new ProviderConfigResolver().resolve({
        zcodeBuiltinProviders: zcodeBuiltin.providers,
        zcodeBuiltinModelRules: zcodeBuiltin.models,
        accountProviders: new ProviderConfigMap([
          [
            "account:zai-offpeak-idle-plan",
            new ProviderConfig({
              access: new ZhipuAccountAccessConfig({ entitled: true }),
            }),
          ],
          [
            "account:bigmodel-offpeak-idle-plan",
            new ProviderConfig({
              access: new ZhipuAccountAccessConfig({ entitled: true }),
            }),
          ],
        ]),
        personalProviders: ProviderConfigMap.empty(),
        personalModels: ModelConfigRules.empty(),
      });
      const registry = new ProviderRegistry(resolution.registryProviders);

      const result = buildOffPeakModelSelectionView(registry.getView());

      expect(result.providers).toHaveLength(2);
      expect(result.providers[0]).toMatchObject({
        providerId: "account:zai-offpeak-idle-plan",
        config: {
          visibility: "hidden",
          access: { type: "zhipu-account", accountType: "zai", mode: "off-peak" },
        },
      });
      for (const provider of result.providers) {
        expect(provider.models.map((model) => model.modelId)).toEqual(["GLM-5.3", "GLM-5.3-Flash"]);
        for (const model of provider.models) {
          const flash = model.modelId === "GLM-5.3-Flash";
          expect(model.config).toMatchObject({
            enabled: true,
            properties: {
              contextWindow: 1_000_000,
              inputFormat: { supportsImage: flash, supportsVideo: flash, supportsPdf: flash },
              supportsNativeWebSearch: false,
              supportsMidConversationSystem: true,
            },
            optionSpecs: {
              reasoningLevel: { values: ["low", "high", "max"], map: expect.any(String) },
              maxOutputTokens: { max: 128000, map: expect.any(String) },
            },
          });
        }
      }
      expect(result.providers[1]).toMatchObject({
        providerId: "account:bigmodel-offpeak-idle-plan",
        config: {
          visibility: "hidden",
          access: { type: "zhipu-account", accountType: "bigmodel", mode: "off-peak" },
        },
      });
    } finally {
      source.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("不投影非固定 Provider 与非隐藏 Provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-off-peak-view-filter-"));
    const builtinFilePath = join(root, "zcode-builtin.json");
    const release = offPeakBuiltinRelease() as {
      config: { providerConfigRules: { providerRules: Array<{ config: Record<string, unknown> }> } };
    };
    // 同一套 provider 声明，但去掉 hidden：投影必须为空（可见候选不走闲时面）。
    for (const rule of release.config.providerConfigRules.providerRules) {
      delete rule.config.visibility;
    }
    await writeFile(builtinFilePath, JSON.stringify(release), "utf8");
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: builtinFilePath,
      watch: false,
    });
    try {
      const zcodeBuiltin = await source.read();
      const resolution = new ProviderConfigResolver().resolve({
        zcodeBuiltinProviders: zcodeBuiltin.providers,
        zcodeBuiltinModelRules: zcodeBuiltin.models,
        accountProviders: new ProviderConfigMap([
          [
            "account:zai-offpeak-idle-plan",
            new ProviderConfig({ access: new ZhipuAccountAccessConfig({ entitled: true }) }),
          ],
        ]),
        personalProviders: ProviderConfigMap.empty(),
        personalModels: ModelConfigRules.empty(),
      });
      const registry = new ProviderRegistry(resolution.registryProviders);

      const result = buildOffPeakModelSelectionView(registry.getView());

      expect(result.providers).toEqual([]);
    } finally {
      source.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
