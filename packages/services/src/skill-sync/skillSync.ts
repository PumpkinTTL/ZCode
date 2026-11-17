import type { SkillDataSyncPayload } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { IDataSyncCategoryService } from "../data-sync/contract.js";
import type { SkillSyncCandidateMethods } from "./skillSyncCandidates.js";

/** 技能同步服务：数据同步弹窗使用 IDataSyncCategoryService 的统一形状；本地候选/归档同步面为 Polaris 企业自有。 */
export type ISkillSyncService = IDataSyncCategoryService<SkillDataSyncPayload> & SkillSyncCandidateMethods;

export const ISkillSyncService = createServiceDescriptor<ISkillSyncService>(
  ServiceChannels.SkillSync,
);
