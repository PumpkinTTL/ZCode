import type { ApiClient } from "@zcode/shared";
import type { ClientScenesResponse, IClientScenesService } from "./clientScenes.js";

/**
 * Polaris fork：客户端场景（首页推荐词 / Automations 模板目录）原先来自官方远端
 * `/api/v1/client/scenes`。自有后端尚未就绪，这里改为返回空列表的空实现：
 * 不发任何网络请求、不抛错，界面稳定收敛为空态（推荐词列表与模板目录均为空）。
 *
 * 接口 `IClientScenesService` 与工厂签名保持不变；接自有后端时在这里实现 `list()`
 * 即可（依赖对象 `apiClient` 已按原样保留），调用点无需改动。
 */
export function createClientScenesService(dependencies: {
  apiClient: ApiClient;
}): IClientScenesService {
  // 空实现不消费依赖；参数保留以维持既有装配点（node.ts / desktop remote Host）的调用兼容。
  void dependencies;
  return {
    list: async (): Promise<ClientScenesResponse> => ({ code: 0, msg: "", data: [] }),
  };
}
