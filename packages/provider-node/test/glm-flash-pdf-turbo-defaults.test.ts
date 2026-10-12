import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ModelConfig, ModelConfigRules } from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "../src/index.js";

describe("Todo126 发布配置的 Flash PDF 默认", () => {
  it("Flash 的全部格式/站点/别名支持 PDF，其他型号和个人覆盖不变", async () => {
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: fileURLToPath(
        new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
      ),
      watch: false,
    });
    try {
      const snapshot = await source.read();
      for (const type of ["provider-model", "manual-provider-model"] as const) {
        const personal = new ModelConfigRules([
          {
            type,
            providerId: "personal",
            modelId: "GLM-5.3-Flash",
            config: new ModelConfig({ properties: { inputFormat: { supportsPdf: false } } }),
          },
        ]);
        const composed = ModelConfigRules.composeEffective(snapshot.models, personal);
        const effective = composed.resolve({
          providerId: "personal",
          modelId: "GLM-5.3-Flash",
          apiType: "openai-responses",
        });
        expect(effective.properties?.inputFormat?.supportsPdf).toBe(false);
        if (type === "manual-provider-model")
          expect(effective.properties?.inputFormat?.supportsImage).toBeUndefined();
      }
      for (const apiType of [
        "anthropic-messages",
        "openai-chat-completions",
        "openai-responses",
      ] as const) {
        for (const baseUrl of [
          "https://api.z.ai/api/anthropic",
          "https://open.bigmodel.cn/api/anthropic",
          "https://proxy.example/v1",
        ]) {
          for (const modelId of ["GLM-5.3-Flash", "glm-5.3-flash", "vendor/GLM-5.3-Flash:free"]) {
            const config = snapshot.models.resolve({
              providerId: "custom",
              modelId,
              apiType,
              baseUrl,
            });
            expect(
              config.properties?.inputFormat?.supportsPdf,
              `${apiType}/${baseUrl}/${modelId}`,
            ).toBe(true);
            expect(
              config.overlay(
                new ModelConfig({ properties: { inputFormat: { supportsPdf: false } } }),
              ).properties?.inputFormat?.supportsPdf,
            ).toBe(false);
          }
          for (const modelId of ["GLM-5.3", "GLM-4.7"]) {
            const config = snapshot.models.resolve({
              providerId: "custom",
              modelId,
              apiType,
              baseUrl,
            });
            expect(config.properties?.inputFormat?.supportsPdf).toBe(false);
          }
        }
      }
    } finally {
      source.dispose();
    }
  });
});
