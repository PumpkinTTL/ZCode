// Polaris CUA 原生层宿主。
//
// Phase 1：全部原生操作委托给 cua-driver（UIA / 输入 / 截图都由它提供），本模块只承载
// dev-runtime 包契约里的 `nativeAddon` 锚点与 Phase 2（koffi FFI → UIA/user32 直调）的位置。
// 加载失败/未就绪时返回 ready:false，调用方据此 fail-closed。
export const NATIVE_LAYER_KIND = "driver-delegated";

export function loadNativeLayer() {
  return {
    kind: NATIVE_LAYER_KIND,
    ready: false,
    detail:
      "Native operations are delegated to cua-driver in this build; " +
      "the in-process FFI layer is not compiled yet.",
  };
}
