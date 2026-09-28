import type { AppSettings } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

// Polaris：首启推荐的两家第三方模板。智谱系模板（zai-api / bigmodel-api）已随官方业务
// 移除，不能再作为首启选择（模板不存在会导致创建失败）。候选只放现存的内置模板；
// 接自有套餐后在这里换成自有模板即可。
export type ApiKeyProviderChoice = "deepseek" | "moonshot-kimi";

const API_KEY_PROVIDER_TEMPLATE_IDS = {
  deepseek: "deepseek",
  "moonshot-kimi": "moonshot-kimi",
} as const;

export function resolveApiKeySetupDefaultProvider(): ApiKeyProviderChoice {
  return "deepseek";
}

export function resolveApiKeySetupTemplateId(
  choice: ApiKeyProviderChoice,
): (typeof API_KEY_PROVIDER_TEMPLATE_IDS)[ApiKeyProviderChoice] {
  return API_KEY_PROVIDER_TEMPLATE_IDS[choice];
}

export function resolveApiKeySetupProviderLabel(choice: ApiKeyProviderChoice): string {
  return choice === "moonshot-kimi" ? "Kimi" : "DeepSeek";
}

export function buildApiKeySetupSkipSettings(
  choice: ApiKeyProviderChoice,
  now: number,
): Pick<AppSettings, "providerFamilyDomainUpdatedAt" | "providerFamilyDomainMigrated"> {
  // 第三方模板不属于 zai/bigmodel 家族，不能写 providerFamilyDomain
  //（schema 只接受这两个值，非法值会让整份 settings 校验失败）。
  return {
    providerFamilyDomainUpdatedAt: now,
    providerFamilyDomainMigrated: true,
  };
}

export function shouldShowApiKeySetupLink(
  apiKeyValue: string,
  apiKeyUrl: string | undefined,
): boolean {
  return Boolean(apiKeyUrl) && apiKeyValue.trim().length === 0;
}

export function buildApiKeySetupDefaultModelPreferenceFromSelection(
  view: ModelSelectionView,
  providerId: string,
): string | null {
  const firstModel = view.providers.find((provider) => provider.providerId === providerId)
    ?.models[0]?.modelId;
  return firstModel ? encodeCustomModelValue(providerId, firstModel) : null;
}
