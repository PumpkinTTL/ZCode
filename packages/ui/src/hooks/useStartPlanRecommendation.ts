/** Polaris：上游同名模块依赖的业务/遥测面已随红线砍除；此桩仅保接口形状（恒空实现/恒空数据）。 */
export function useStartPlanRecommendation(..._args: unknown[]): Record<string, unknown> {
  return new Proxy({}, {
    get: (_t, k) => {
      if (k === 'then') return undefined;
      if (typeof k === 'string' && /^(cancel|complete|fail|dismiss|dispose|clear|reset|release|unsubscribe|unregister|subscribe|close|remove|send|report|mutate|invalidate)/.test(k)) {
        return () => undefined;
      }
      return undefined;
    },
  });
}
