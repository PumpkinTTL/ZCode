/**
 * 用户社群入口总开关。
 *
 * Polaris 尚未提供自有社群，而官方社群地址（飞书 / Discord）对用户不可达——入口留着
 * 只会点开一个坏链接。这里统一收口为「默认关闭」，而不是删除命令与菜单结构：
 * 接入自有社群后，把社群地址写进 config 的 `community_urls`，再把本常量改回 true
 * 即可恢复全部入口（quick pick 的「用户社群」与帮助菜单同名项）。
 *
 * 显式标注为 boolean：避免字面量类型 false 让下游分支被推断成恒不可达，
 * 这个开关是运行时产品开关，不是编译期裁剪。
 */
export const COMMUNITY_ENTRY_ENABLED: boolean = false;
