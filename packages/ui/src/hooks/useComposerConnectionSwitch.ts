/** Polaris：业务模块已随红线砍除；此桩仅保导入形状（恒空实现/恒空数据），零出网。 */
export function useComposerConnectionSwitch(..._args: unknown[]): Record<string, unknown> {
  return new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => undefined) });
}