import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";

/**
 * Composer 合并菜单的分组类型兼容层。
 *
 * 上游同名模块曾在此把账号套餐（个人/团队 Coding Plan）与连接切换身份（family/
 * selection）投影成菜单分组；Polaris 不接官方套餐，分组一律回退
 * `modelSelectionGroups.buildRegistryModelSelectGroups` 的自研体系（接入标识只保留
 * API Key 一态）。这里仅保留结构类型，供 ComposerModelMenu 以同一接口消费普通分组。
 */
export interface ComposerConnection {
  key: string;
  label: string;
  providerId: string;
  items: ModelSelectGroupItem[];
  disabled?: boolean;
}

export interface ComposerPlanGroup extends ModelSelectGroup {
  connection?: ComposerConnection;
}
