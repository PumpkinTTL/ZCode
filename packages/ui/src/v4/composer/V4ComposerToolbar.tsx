/* oxlint-disable eslint(max-lines) -- V4ComposerToolbar 汇聚模型/思考深度/context usage 三件套；继续拆分会打散工具条热键与模型目录 memo 的共享状态。 */
/**
 * V4 composer 工具条。
 *
 * 展示件全部复用旧 chat-input-toolbar 的纯 props 组件（ModelConfigSelect /
 * ChatModeSwitchControl / ThoughtLevelCycleControl / ChatContextUsage），外观与旧
 * ChatInputToolbar 对齐；但状态编排是全新 v4 wiring，不复活旧 ChatInputToolbar 的
 * effect 链 / 旧协议写路径：
 * - 当前模型/档位来自 Composer；已运行会话的用量来自 snapshot.usage.contextWindow
 * - 模型、思考深度和模式只更新下一次 Submission 的 Composer 意图
 * - 模型静态事实来自目标 Host ModelSelectionView；workspace configOptions 只提供
 *   mode 等非模型 presentation
 *
 * 新任务和已有会话采用相同的 Composer 显示事实；prewarm 不补模型或档位。
 * 提交时由宿主（SessionPane）把冻结选择随 Submission 一起发送。
 * 三件套不能全部门控在 config!==null 上——草稿态会整体不渲染。
 *
 * 模型与思考深度合并入口（ComposerModelMenu）：模型 + Effort 共用一个菜单，
 * Provider 子菜单只列模型供应商（接入标识仅 API Key 一态）；选择链路仍是
 * onSelectModel / onSelectThought 唯一 owner，不引入第二份选择状态。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZCODE_AGENT_PROVIDER, type ZCodeConfigOption, type ZCodeProvider } from "@zcode/shared";
import { TID_V4_MODEL_CONFIG, TID_V4_COMPOSER_INPUT } from "@zcode/shared/test-ids";
import type {
  SessionConfigState,
  SessionPhase,
  SessionUsageState,
} from "@zcode/shared/zcode-protocol-v4";
import { ModelConfigSelect, type ModelSelectGroup } from "@/ModelConfigSelect.js";
import type { ComposerModelOptions } from "@/chat-input-toolbar/ComposerModelMenu.js";
import { Button } from "@/components/ui/button.js";
import { ChatContextUsage } from "@/chat-input-toolbar/display.js";
import {
  getNextThoughtLevelValue,
  getThoughtLevelLabel,
} from "@/chat-input-toolbar/thoughtLevelOptions.js";
import type { V4ComposerConfigPicker } from "@/v4/composer/configPickerState.js";
import { useToolbarShortcutBindings } from "@/v4/composer/toolbarShortcuts.js";
import {
  resolveModelSelectTriggerDisplay,
  shouldShowManageModelsAction,
} from "@/chat-input-toolbar/modelSelection.js";
import { resolveV4ModelTriggerDisplay } from "@/v4/composer/modelTriggerDisplay.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import type { ModelSelectionView } from "@zcode/services";
import type {
  ModelSelectionState,
  ModelSelectionRefreshResult,
} from "@/hooks/useModelSelectionView.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useToolbarConfigOptions } from "@/hooks/useZCodeConfig.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { logger } from "@/logger.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import { provisionNimbusProvider } from "@/business/quota/provisionNimbusProvider.js";
import { useNimbusModelCatalogRefresh } from "@/business/quota/nimbusModelCatalogRefresh.js";
import { toast } from "@/components/ui/toast.js";
import { useServices } from "@/hooks/useServices.js";
import { useNimbusAccountState } from "@/business/quota/nimbusAccountState.js";
import { CloudDownload } from "lucide-react";
import {
  resolveDraftDisplayedConfig,
  resolveDraftModelThoughtOption,
  resolveDraftThoughtCurrentValue,
} from "@/v4/composer/draftWorkspaceDefaults.js";

// 拆分件再导出（模式选择移居 V4ComposerModeControls，超行数拆分）：
// 既有消费方（ConversationComposer）继续从本模块入口 import，接口面不变。
export { V4ComposerModeSwitch } from "@/v4/composer/V4ComposerModeControls.js";

const V4_COMPOSER_INPUT_SELECTOR = `[data-testid="${TID_V4_COMPOSER_INPUT}"]`;
const MODEL_SELECTION_LOADING_STATE: ModelSelectionState = { status: "loading" };

/** 稳定空回调（热键 hook 单实例只处理本组件拥有的选项，其余动作占位）。 */
function noop(): void {}

export interface ModelSelectionSource {
  provider: string;
  model: string;
}

export interface V4ComposerToolbarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  modelSelectionView?: ModelSelectionView | null;
  modelSelectionState?: ModelSelectionState;
  modelSelectionReload?: () => void;
  modelSelectionRefresh?: () => Promise<ModelSelectionRefreshResult>;
  sessionId: string | null;
  phase: SessionPhase | null;
  provider?: ZCodeProvider;
  /** 当前工具条是否运行在 Web 远控壳中。 */
  isWebRemoteControl?: boolean;
  /** 当前视口是否为手机输入布局。 */
  isMobileViewport?: boolean;
  /** 草稿态（sessionId=null），仅区分新任务呈现，不改变选择来源。 */
  draftMode?: boolean;
  /** 当前 scope 的 Composer 选择；新任务与已有会话都只显示这份状态。 */
  draftConfig?: Partial<SessionConfigState>;
  usage: SessionUsageState | null;
  disabled: boolean;
  /** 单个 composer 内的配置 picker 排他 owner；只属于 renderer-local presentation。 */
  activeConfigPicker: V4ComposerConfigPicker | null;
  onConfigPickerOpenChange: (picker: V4ComposerConfigPicker, open: boolean) => void;
  /**
   * 选中模型（providerId/modelId 来自目录 value 解码），由 Composer owner 更新并持久化。
   * sourceModel 只表达这次用户操作的来源，不从 Session 投影补 CAS 或思考档位。
   */
  onSelectModel: (
    provider: string,
    model: string,
    sourceModel: ModelSelectionSource | null,
    reasoningLevel?: string,
  ) => void;
  /** 选中思考深度；modelContext 固定本次用户操作的目标模型。 */
  onSelectThought: (thought: string, modelContext: { provider: string; model: string }) => void;
  onSwitchMode: (mode: string) => void;
  /** prepare/configOptions 失败时，custom provider 选择走 workspace recovery 链。 */
  onRecoverCustomModelSelection?: (
    value: string,
    sourceModel: ModelSelectionSource | null,
  ) => Promise<void> | void;
  onSendCompressionCommand?: (command: string) => void;
}

/** 模型 / 思考深度 / context usage 簇（渲染在发送键左侧，与旧 UI 同位）。 */
function V4ComposerModelControlsImpl({
  workspacePath,
  workspaceIdentity,
  modelSelectionView = null,
  modelSelectionState = MODEL_SELECTION_LOADING_STATE,
  modelSelectionReload,
  provider,
  isWebRemoteControl = false,
  isMobileViewport = false,
  draftMode = false,
  draftConfig,
  usage,
  disabled,
  activeConfigPicker,
  onConfigPickerOpenChange,
  onSelectModel,
  onSelectThought,
  onSendCompressionCommand,
  onRecoverCustomModelSelection,
}: V4ComposerToolbarProps) {
  const { intl, locale } = useZCodeIntl();
  const displayProvider = provider ?? ZCODE_AGENT_PROVIDER;
  // 配置面读取：workspace 缺省目录（taskId=null），不读旧会话态。
  const { error: configOptionsError } = useToolbarConfigOptions(
    workspacePath,
    null,
    workspaceIdentity,
  );
  const providerSettingsRead = useProviderSettingsView();
  const providerSourcesLoading = providerSettingsRead.state.status !== "ready";
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const modelTriggerRef = useRef<HTMLSpanElement | null>(null);
  // Ctrl+M 热键：递增 openRequestKey 请求 ModelConfigSelect 打开菜单（旧 handleOpenModelMenuShortcut 语义）。
  const [modelMenuOpenRequestKey, setModelMenuOpenRequestKey] = useState(0);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const handleOpenModelMenuShortcut = useCallback(() => {
    setModelMenuOpenRequestKey((current) => current + 1);
  }, []);
  const handleModelPickerOpenChange = useCallback(
    (open: boolean) => {
      onConfigPickerOpenChange("model", open);
    },
    [onConfigPickerOpenChange],
  );

  const modelOption = modelSelectionView?.providers.some((provider) => provider.models.length > 0)
    ? ({
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "",
        options: [],
      } satisfies ZCodeConfigOption)
    : undefined;

  // 空模型/档位曾被 Session 旧值补回，界面显示与实际不可提交状态矛盾。
  // 初始化已经由 Composer owner 完成；显示层只消费它，不能再次补值。
  const effectiveConfig = useMemo<SessionConfigState | null>(() => {
    return resolveDraftDisplayedConfig(draftConfig ?? {});
  }, [draftConfig]);

  // 高频交互排障只走 debug，避免生产日志量随每次选择增长。
  useEffect(() => {
    if (!draftMode) return;
    logger.debug("[v4-toolbar] draft effectiveConfig changed", {
      provider: effectiveConfig?.provider ?? null,
      model: effectiveConfig?.model ?? null,
      thought: effectiveConfig?.thought ?? null,
      modelSelectionRevision: modelSelectionView?.revision ?? null,
    });
  }, [draftMode, effectiveConfig, modelSelectionView?.revision]);

  const { providerQuotaService, providerSettingsService } = useServices();
  const nimbusAccount = useNimbusAccountState();
  // 官方模型展示元数据（倍率/标签/折扣）挂载时按需刷新（模块级节流）。
  useNimbusModelCatalogRefresh();
  // 官方（Nimbus）模型目录手动同步：入口在菜单里官方分组标题行的图标（CloudDownload，
  // 同步中转圈），不弹任何独立面板。幂等开通（key/基址/模型目录以远端为准）。
  const [officialSyncing, setOfficialSyncing] = useState(false);
  const syncOfficialModels = useCallback(() => {
    if (officialSyncing) return;
    setOfficialSyncing(true);
    provisionNimbusProvider({
      quota: providerQuotaService,
      providerSettings: providerSettingsService,
    })
      .then(() => {
        toast(intl.formatMessage({ id: "chat.toolbar.model.officialModelsSynced" }));
      })
      .catch((error: unknown) => {
        toast(
          intl.formatMessage(
            { id: "chat.toolbar.model.officialModelsSyncFailed" },
            {
              detail: error instanceof Error ? error.message : String(error),
            },
          ),
          { variant: "warning" },
        );
      })
      .finally(() => {
        setOfficialSyncing(false);
      });
  }, [intl, officialSyncing, providerQuotaService, providerSettingsService]);

  // 登出后的官方组可见性：Registry 准入要求凭证完整，登出（已清凭证）后官方供应商
  // 不在 ModelSelectionView 里，选择菜单会整组消失。这里从设置层视图（凭证无关，
  // 登出后模型名单仍在）取官方供应商的模型列表，合成「登录时同形」的扁平分组补进
  // 菜单：项由 isModelOptionLocked 置灰、悬浮提示「登录后可用」。
  const [lockedOfficialProvider, setLockedOfficialProvider] = useState<{
    providerId: string;
    providerName: string;
    models: readonly { modelId: string; displayName: string | null }[];
  } | null>(null);
  const modelSelectGroups = useMemo<ModelSelectGroup[]>(() => {
    if (!modelSelectionView) return [];
    const registryGroups = buildRegistryModelSelectGroups(displayProvider, modelSelectionView, {
      apiKeyLabel: intl.formatMessage({ id: "settings.modelProvider.apiKey" }),
      apiKeyBadgeLabel: intl.formatMessage({
        id: "settings.modelProvider.connectionMode.apiKeyBadge",
      }),
      officialBadgeLabel: intl.formatMessage({ id: "settings.modelProvider.officialBadge" }),
      officialHeaderAction: {
        icon: CloudDownload,
        label: intl.formatMessage({ id: "chat.toolbar.model.syncOfficialModels" }),
        spinning: officialSyncing,
        onSelect: syncOfficialModels,
      },
    });
    // 合成组只在 Registry 缺失该官方供应商时出现（登录时走真实分组，天然互斥）；
    // 登出态不给同步图标（没有凭证，同步必然失败）。
    if (
      lockedOfficialProvider !== null &&
      !registryGroups.some(
        (group) => group.key === `registry-provider:${lockedOfficialProvider.providerId}`,
      )
    ) {
      const synthesized: ModelSelectGroup = {
        key: `registry-provider:${lockedOfficialProvider.providerId}`,
        label: lockedOfficialProvider.providerName,
        labelBadge: intl.formatMessage({ id: "settings.modelProvider.officialBadge" }),
        directItems: true,
        items: lockedOfficialProvider.models.map((model) => ({
          key: `registry-provider:${lockedOfficialProvider.providerId}:${model.modelId}`,
          value: encodeCustomModelValue(lockedOfficialProvider.providerId, model.modelId),
          name: model.displayName?.trim() || model.modelId,
          iconModelId: model.modelId,
          iconProviderId: lockedOfficialProvider.providerId,
        })),
      };
      return [synthesized, ...registryGroups];
    }
    return registryGroups;
  }, [
    displayProvider,
    intl,
    modelSelectionView,
    lockedOfficialProvider,
    officialSyncing,
    syncOfficialModels,
  ]);

  // 修复：恢复「管理模型」入口（老版 onManageModels = 打开设置页并定位模型供应商区）。
  const handleOpenModelProviderSettings = useCallback(() => {
    setPendingSettingsSectionIntent("modelProvider");
    openSettingsTab();
  }, [openSettingsTab]);
  const showManageModelsAction = shouldShowManageModelsAction(handleOpenModelProviderSettings);
  const manageModelsLabel = intl.formatMessage({
    id: "chat.toolbar.model.manageModels",
  });

  // 当前投影模型的编码值：provider 命中目录则按自定义模型编码，否则回落裸 model id。
  const rawModelValue = useMemo(() => {
    if (!effectiveConfig || !effectiveConfig.model) return "";
    const providerExists = modelSelectionView?.providers.some(
      (candidate) => candidate.providerId === effectiveConfig.provider,
    );
    if (providerExists) {
      return encodeCustomModelValue(effectiveConfig.provider, effectiveConfig.model);
    }
    return effectiveConfig.model;
  }, [effectiveConfig, modelSelectionView]);

  // 触发器显示兜底——`<synthetic>`（SDK 恢复时合成的占位模型）或当前模型
  // 不在可选组（失效/下线/退登）→ 回落占位/默认「选择模型」，不直显协议内部占位符或失效
  // 模型 id。复用存活的 resolveModelSelectTriggerDisplay。
  const triggerDisplay = useMemo(
    () =>
      resolveModelSelectTriggerDisplay(
        rawModelValue,
        modelSelectGroups,
        showManageModelsAction,
        manageModelsLabel,
      ),
    [manageModelsLabel, modelSelectGroups, rawModelValue, showManageModelsAction],
  );
  const normalizedModelValue = triggerDisplay.value ?? "";

  const modelTriggerDisplay = useMemo(() => {
    // 非可选值（未选 / synthetic / 不可用）：占位文案或默认「选择模型」。
    const fallbackLabel =
      triggerDisplay.placeholder ?? intl.formatMessage({ id: "chat.toolbar.model.label" });
    const providerName =
      modelSelectionView?.providers.find(
        (candidate) => candidate.providerId === effectiveConfig?.provider,
      )?.providerName ?? undefined;
    return resolveV4ModelTriggerDisplay({
      modelGroups: modelSelectGroups,
      normalizedValue: normalizedModelValue,
      fallbackLabel,
      providerId: effectiveConfig?.provider,
      providerName,
    });
  }, [
    effectiveConfig?.provider,
    intl,
    modelSelectionView,
    modelSelectGroups,
    normalizedModelValue,
    triggerDisplay.placeholder,
  ]);

  // 当前模型所属供应商（上下文弹窗的 Nimbus 额度块判定输入）：直接从目标 Host 的
  // ModelSelectionView 取有效配置，零额外 IPC；不是 Nimbus 时组件自渲染 null。
  const currentModelProvider = useMemo(() => {
    const providerId = effectiveConfig?.provider;
    if (!providerId || !modelSelectionView) return null;
    const provider = modelSelectionView.providers.find(
      (candidate) => candidate.providerId === providerId,
    );
    if (!provider) return null;
    return {
      providerName: provider.providerName,
      templateId: provider.templateId,
      api: provider.config.api,
    };
  }, [effectiveConfig?.provider, modelSelectionView]);
  const handleModelValueChange = useCallback(
    (value: string, reasoningLevel?: string) => {
      const decoded = decodeCustomModelValue(value);
      // 草稿的点击时可见模型可能只存在于 catalog，或已经被最新 draft
      // intent 覆盖，不能让 SessionPane 再从迟到的 prewarm projection 反推。
      const sourceModel =
        effectiveConfig?.provider && effectiveConfig.model
          ? {
              provider: effectiveConfig.provider,
              model: effectiveConfig.model,
            }
          : null;
      // debug 日志（草稿态切模型排障）：点击值 + 解码分支。
      logger.debug("[v4-toolbar] model select onValueChange", {
        value,
        decodedProviderId: decoded?.providerId ?? null,
        decodedModelName: decoded?.modelName ?? null,
        draftMode,
      });
      const selectedRegistryProvider = decoded?.providerId
        ? modelSelectionView?.providers.find(
            (candidate) => candidate.providerId === decoded.providerId,
          )
        : undefined;
      const customRecoveryEligible = isApiKeyAccess(selectedRegistryProvider?.config.access);
      if (
        configOptionsError &&
        decoded?.providerId &&
        customRecoveryEligible &&
        onRecoverCustomModelSelection
      ) {
        setRecoveryPending(true);
        void Promise.resolve(onRecoverCustomModelSelection(value, sourceModel))
          .catch((error) => {
            logger.warn("[v4-toolbar] custom provider recovery failed", {
              error: error instanceof Error ? error.message : String(error),
              providerId: decoded.providerId,
            });
          })
          .finally(() => {
            setRecoveryPending(false);
          });
        return;
      }
      if (decoded) {
        if (reasoningLevel !== undefined)
          onSelectModel(decoded.providerId, decoded.modelName ?? "", sourceModel, reasoningLevel);
        else onSelectModel(decoded.providerId, decoded.modelName ?? "", sourceModel);
        return;
      }
      const slashIndex = value.indexOf("/");
      if (slashIndex > 0) {
        onSelectModel(value.slice(0, slashIndex), value.slice(slashIndex + 1), sourceModel);
        return;
      }
      // 裸 model id：provider 沿用当前（宿主从最新投影补齐）。
      onSelectModel("", value, sourceModel);
    },
    [
      configOptionsError,
      displayProvider,
      draftMode,
      effectiveConfig?.model,
      effectiveConfig?.provider,
      onRecoverCustomModelSelection,
      onSelectModel,
      modelSelectionView,
      workspaceIdentity,
      workspacePath,
    ],
  );

  const draftModelThoughtOption = useMemo(
    () =>
      effectiveConfig
        ? resolveDraftModelThoughtOption(
            effectiveConfig.provider,
            effectiveConfig.model,
            modelSelectionView,
          )
        : null,
    [effectiveConfig, modelSelectionView],
  );

  // 候选档位只来自目标 Host 的 ModelSelectionView，已选档位只来自 Composer。
  const thoughtOption = useMemo<ZCodeConfigOption | null>(() => {
    if (!effectiveConfig) return null;
    if (!draftModelThoughtOption) return null;
    return {
      ...draftModelThoughtOption,
      currentValue: resolveDraftThoughtCurrentValue({
        thought: effectiveConfig.thought,
        thoughtLevels: draftModelThoughtOption.options?.map((option) => option.value) ?? [],
      }),
    };
  }, [draftModelThoughtOption, effectiveConfig]);

  const handleThoughtValueChange = useCallback(
    (value: string) => {
      if (!effectiveConfig) return;
      if (!value.trim()) {
        // 跨模型受控 Select 重建时可能抛出一次空 value；它不是用户选择，
        // 若继续上抛会把模型 intent 标成 superseded，导致 accepted 模型无法写入全局元组。
        logger.debug("[v4-toolbar] ignore synthetic empty thought change", {
          model: effectiveConfig.model,
          provider: effectiveConfig.provider,
        });
        return;
      }
      onSelectThought(value, {
        provider: effectiveConfig.provider,
        model: effectiveConfig.model,
      });
    },
    [effectiveConfig, onSelectThought],
  );

  // Ctrl+T 热键：按目录顺序循环下一次 Submission 的思考深度。
  const handleCycleThoughtLevel = useCallback(() => {
    if (!thoughtOption || thoughtOption.type !== "select") {
      return;
    }
    const nextValue = getNextThoughtLevelValue(thoughtOption);
    if (nextValue == null) {
      return;
    }
    if (!effectiveConfig) return;
    onSelectThought(nextValue, {
      provider: effectiveConfig.provider,
      model: effectiveConfig.model,
    });
  }, [effectiveConfig, onSelectThought, thoughtOption]);

  const taskUsage = useMemo(() => {
    const contextWindow = usage?.contextWindow;
    if (!contextWindow) return null;
    return {
      used: contextWindow.usedTokens,
      size: contextWindow.maxTokens,
      ...(contextWindow.cache ? { cache: contextWindow.cache } : {}),
      ...(contextWindow.breakdown ? { breakdown: contextWindow.breakdown } : {}),
    };
  }, [usage?.contextWindow]);
  // 工具条热键已转正为命令表命令：tooltip 快捷键文案读生效表，
  // 改绑后按钮提示即时跟随（不能用硬编码文案）。
  const modelShortcutLabel = useShortcutCommandLabel("openModelMenu");
  const thoughtShortcutLabel = useShortcutCommandLabel("cycleThoughtLevel");
  // 合并菜单（模型 + Effort 共用入口）的展示选项：档位目录来自目标 Host，
  // 已选档位只来自 Composer；Provider 子菜单复用 modelSelectGroups，
  // 接入标识只保留 API Key 一态（buildRegistryModelSelectGroups）。
  // 原因：内联对象会在无关渲染时使 memo 选择器失效；按展示事实和回调缓存选项。
  const composerOptions = useMemo<ComposerModelOptions>(
    () => ({
      providerLabel: intl.formatMessage({ id: "chat.toolbar.combined.provider" }),
      modelsLabel: intl.formatMessage({ id: "chat.toolbar.combined.models" }),
      effortLabel: intl.formatMessage({ id: "chat.toolbar.combined.effort" }),
      effortShortcutLabel: thoughtShortcutLabel,
      selectModelLabel: intl.formatMessage({ id: "chat.toolbar.combined.selectModel" }),
      levels:
        thoughtOption?.options?.map((entry) => ({
          value: entry.value,
          label: getThoughtLevelLabel(intl, displayProvider, thoughtOption, entry),
        })) ?? [],
      value: String(thoughtOption?.currentValue ?? ""),
      onValueChange: handleThoughtValueChange,
    }),
    [intl, thoughtShortcutLabel, thoughtOption, displayProvider, handleThoughtValueChange],
  );
  // 官方（Nimbus）供应商 id：登出后用它做「官方模型置灰」的判定锚点。
  // Registry 里没有（登出态）时回落到合成组的 providerId，保证合成项同样被锁定。
  const nimbusProviderId = useMemo(
    () =>
      modelSelectionView?.providers.find((provider) => provider.config.group === "nimbus")
        ?.providerId ??
      lockedOfficialProvider?.providerId ??
      null,
    [modelSelectionView, lockedOfficialProvider],
  );
  // 账号明确未登录（status !== null）→ 官方模型置灰、禁止选择；面板结构不动。
  // status=null（首查在途）刻意不锁：锁了会让已登录用户每次冷启动都闪「请登录」误锁；
  // 未登录用户此刻的选择会在快照到达后由下方逻辑自动切离官方供应商，自愈。
  const officialModelsLocked = nimbusAccount.status !== null && !nimbusAccount.loggedIn;
  const isModelOptionLocked = useCallback(
    (candidateValue: string) => {
      if (!officialModelsLocked || nimbusProviderId === null) return false;
      return decodeCustomModelValue(candidateValue)?.providerId === nimbusProviderId;
    },
    [officialModelsLocked, nimbusProviderId],
  );
  const modelLockReasonMessage = officialModelsLocked
    ? intl.formatMessage({ id: "chat.toolbar.model.officialLoginRequired" })
    : intl.formatMessage({ id: "chat.toolbar.modelSwitch.lockedByRunningTask" });

  // 登出（确认未登录）时从设置层视图拉官方供应商的模型名单做合成组；
  // 重新登录立即清空（Registry 恢复后走真实分组）。失败静默保持现状。
  useEffect(() => {
    if (!officialModelsLocked) {
      setLockedOfficialProvider(null);
      return;
    }
    let cancelled = false;
    void providerSettingsService
      .getView()
      .then((view) => {
        if (cancelled) return;
        const provider = view.providers.find(
          (candidate) => candidate.effectiveConfig.group === "nimbus",
        );
        if (!provider) {
          setLockedOfficialProvider(null);
          return;
        }
        setLockedOfficialProvider({
          providerId: provider.providerId,
          providerName: provider.providerName?.trim() || provider.providerId,
          models: provider.models.map((model) => ({
            modelId: model.modelId,
            displayName: model.effectiveConfig.displayName ?? null,
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setLockedOfficialProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, [officialModelsLocked, providerSettingsService, nimbusAccount.status]);

  // 登出后的选择收敛：确认未登录且当前选择仍挂在官方供应商上时，自动切换到
  // 用户自己配置的模型（优先 personal 供应商，其次任一非官方供应商的第一个模型）。
  // 条件幂等：切换成功后 provider 不再等于官方 id，效应自然停。
  useEffect(() => {
    if (!officialModelsLocked || nimbusProviderId === null) return;
    if (effectiveConfig?.provider !== nimbusProviderId) return;
    const providers = modelSelectionView?.providers ?? [];
    const personal = providers.find(
      (provider) => provider.config.group === "standard-personal" && provider.models.length > 0,
    );
    const fallbackProvider =
      personal ??
      providers.find(
        (provider) => provider.providerId !== nimbusProviderId && provider.models.length > 0,
      );
    const fallbackModel = fallbackProvider?.models[0]?.modelId;
    if (!fallbackProvider || !fallbackModel) return;
    logger.info("[v4-toolbar] Nimbus 已登出，当前选择自动切换到用户自配模型", {
      fromProvider: nimbusProviderId,
      toProvider: fallbackProvider.providerId,
      toModel: fallbackModel,
    });
    handleModelValueChange(encodeCustomModelValue(fallbackProvider.providerId, fallbackModel));
  }, [
    officialModelsLocked,
    nimbusProviderId,
    effectiveConfig?.provider,
    modelSelectionView,
    handleModelValueChange,
  ]);

  // 键盘热键（旧 useToolbarShortcutBindings）：Ctrl+M 打开模型菜单、Ctrl+T 循环思考深度。
  // 模式循环（Ctrl+Shift+M）由 V4ComposerModeSwitch 单独绑定（modeOption 在彼处）。
  // 模型留空是正常的待选择状态，包括已有会话；不能因为没有已选模型隐藏重选入口。
  // 有可选组时正常显示；无组但有「管理模型」入口时也显示，避免用户零模型入口。
  const modelMenuVisible = modelSelectGroups.length > 0 || showManageModelsAction;
  // Bug 根因：手机端固定宽度的二级菜单没有消费 Radix 测得的当前方向可用宽度，
  // 共享 min-w-32 还会阻止极窄空间继续收缩。保持二级交互，同时把窗口边缘作为硬上限。
  const providerSubmenuClassName =
    isWebRemoteControl && isMobileViewport
      ? "w-40 min-w-0 max-w-(--radix-dropdown-menu-content-available-width)"
      : undefined;
  useToolbarShortcutBindings({
    hasAnyOption: Boolean(modelOption) || Boolean(thoughtOption),
    toolbarDisabled: disabled || recoveryPending,
    modelMenuDisabled: disabled || recoveryPending || !modelMenuVisible,
    modelOption,
    thoughtOption: thoughtOption ?? undefined,
    onOpenModelMenu: handleOpenModelMenuShortcut,
    onCycleThoughtLevel: handleCycleThoughtLevel,
    onCycleSessionMode: noop,
  });

  return (
    <>
      {/*
        e2e 契约（TID_V4_MODEL_CONFIG）：Composer/usage 状态的 data-* 属性锚点。
        Bug 原因：跨模型切换会主动清除源模型的显式 thought；此时可见控件已按目标模型
        Option Spec 展示默认档位，但旧锚点仍暴露空的原始投影。data-thought 必须与用户
        实际看到的受控值一致，不能重新引入一份草稿状态。
      */}
      <span
        data-testid={TID_V4_MODEL_CONFIG}
        data-source={effectiveConfig || draftConfig?.mode ? "composer" : ""}
        data-provider={effectiveConfig?.provider ?? ""}
        data-model={effectiveConfig?.model ?? ""}
        data-thought={
          thoughtOption?.type === "select"
            ? String(thoughtOption.currentValue ?? "")
            : (effectiveConfig?.thought ?? "")
        }
        data-thought-levels={
          thoughtOption?.type === "select"
            ? (thoughtOption.options ?? []).map((option) => option.value).join(",")
            : ""
        }
        data-mode={draftConfig?.mode ?? ""}
        data-plan-enabled={draftConfig?.planEnabled ?? false}
        data-usage-used={usage?.contextWindow?.usedTokens ?? ""}
        data-usage-max={usage?.contextWindow?.maxTokens ?? ""}
        className="hidden"
      />
      <ChatContextUsage
        taskUsage={taskUsage}
        selectedProvider={displayProvider}
        currentModelProvider={currentModelProvider}
        intl={intl}
        locale={locale}
        onSendCompressionCommand={onSendCompressionCommand}
        compressionDisabled={disabled || recoveryPending}
      />
      {modelSelectionState.status === "error" && modelSelectionReload ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-ui-sm text-destructive"
          onClick={modelSelectionReload}
        >
          {intl.formatMessage({ id: "chat.toolbar.model.loadFailedRetry" })}
        </Button>
      ) : modelSelectionState.status === "unavailable" ? (
        <span className="px-2 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id:
              modelSelectionState.reason === "remote-waiting"
                ? "chat.toolbar.model.remoteWaiting"
                : "chat.toolbar.model.targetMissing",
          })}
        </span>
      ) : modelMenuVisible && !providerSourcesLoading && modelSelectGroups.length === 0 ? (
        // 空配置是正常状态；直接复用 Provider 设置入口，不展开无名称、无模型的菜单。
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-ui-sm"
          data-testid="chat-model-select-trigger"
          onClick={handleOpenModelProviderSettings}
        >
          {manageModelsLabel}
        </Button>
      ) : modelMenuVisible ? (
        <ModelConfigSelect
          key={workspaceIdentity?.trim() || workspacePath}
          modelGroups={modelSelectGroups}
          contentAlign="center"
          normalizedValue={normalizedModelValue}
          triggerLabel={modelTriggerDisplay.modelLabel}
          composerOptions={composerOptions}
          showManageModelsAction={showManageModelsAction}
          manageModelsLabel={manageModelsLabel}
          onManageModels={handleOpenModelProviderSettings}
          lockReasonMessage={modelLockReasonMessage}
          isItemLocked={isModelOptionLocked}
          onValueChange={handleModelValueChange}
          disabled={
            disabled ||
            recoveryPending ||
            (modelSelectionState.status !== "ready" &&
              !(modelSelectionState.status === "loading" && modelSelectionState.catalog))
          }
          tooltipTitle={modelTriggerDisplay.fullLabel}
          shortcutLabel={modelShortcutLabel}
          triggerRef={modelTriggerRef}
          open={activeConfigPicker === "model"}
          onOpenChange={handleModelPickerOpenChange}
          openRequestKey={modelMenuOpenRequestKey}
          labelVisibilityClassName="hidden @sm/composer:inline-flex"
          indicatorClassName="block group-data-[composer-model-icon=true]/toolbar:hidden"
          triggerLabelClassName="block min-w-0 text-left group-data-[composer-model-icon=true]/toolbar:hidden [&>span]:max-w-full [&>span>span]:block [&>span>span]:truncate"
          triggerClassName="composer-model-trigger group-data-[composer-model-icon=true]/toolbar:px-1.5 group-data-[composer-model-icon=true]/toolbar:justify-center"
          triggerIconClassName="hidden group-data-[composer-model-icon=true]/toolbar:inline-flex"
          focusSelectorOnClose={V4_COMPOSER_INPUT_SELECTOR}
          providerSubmenuClassName={providerSubmenuClassName}
        />
      ) : null}
    </>
  );
}

export const V4ComposerModelControls = memo(V4ComposerModelControlsImpl);
import { isApiKeyAccess } from "@zcode/provider";
