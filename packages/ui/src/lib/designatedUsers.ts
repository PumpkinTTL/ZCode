/**
 * 「指定用户专属入口」判定 —— 纯前端白名单，不依赖任何服务端接口。
 *
 * 用途：给白名单用户（内部测试/特定客户）额外渲染一个隐藏菜单入口。
 * 非白名单用户连节点都不渲染（不是 disabled/hidden，DOM 里根本不存在），
 * 天然满足「不破坏现有 UI」：所有现有用户看到的界面零变化。
 *
 * 实现口径：
 * - 身份源 = nimbus 账号（useNimbusAccountState().username）——登录/登出/换号
 *   由既有单一数据源自动广播，订阅方无需额外接线；
 * - 白名单以 FNV-1a 64 位散列形式内嵌（避免明文用户名被直接 grep 提取；
 *   散列不可逆，但须明确：纯前端 = 隐蔽而非安全——反编译产物可见散列集合，
 *   禁止用它承载任何敏感权限判定，服务端兜底仍是唯一安全边界）；
 * - fail-closed：未登录 / 用户名为空 / 白名单为空 → 一律 false。
 *
 * 维护白名单（新增一名指定用户）——在本仓任意 node 环境执行：
 *   node -e "const h=(s)=>{let x=0xcbf29ce484222325n;for(const b of Buffer.from(s.trim().toLowerCase(),'utf8')){x^=BigInt(b);x=BigInt.asUintN(64,x*0x100000001b3n);}console.log(x.toString(16).padStart(16,'0'));};h('用户名')"
 *   把输出字符串加进 DESIGNATED_USERNAME_HASHES 即可（算法与下方实现逐字节一致）。
 */
import type { ReactNode } from "react";
import { useNimbusAccountState } from "@/business/quota/nimbusAccountState.js";

/** FNV-1a 64 位散列（小写十六进制、补齐 16 位）。纯函数、零依赖、跨构建稳定。 */
export function designatedUsernameHash(username: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(username.trim().toLowerCase())) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * 指定用户白名单（散列形式）。空列表 = 所有人不可见（fail-closed，
 * 加用户才逐个填入，不存在「配错反而全开」的失败方向）。
 */
const DESIGNATED_USERNAME_HASHES: readonly string[] = [
  // 新增项格式：designatedUsernameHash("用户名") 输出的 16 位十六进制字符串
];

/** 纯判定：给非 React 场景（菜单构建算法、命令处理）复用。 */
export function isDesignatedUsername(username: string | null | undefined): boolean {
  const normalized = username?.trim();
  if (!normalized || DESIGNATED_USERNAME_HASHES.length === 0) {
    return false;
  }
  return DESIGNATED_USERNAME_HASHES.includes(designatedUsernameHash(normalized));
}

/** React 判定：跟进当前 nimbus 登录态，登录/登出/换号自动重判。 */
export function useIsDesignatedUser(): boolean {
  const { loggedIn, username } = useNimbusAccountState();
  return loggedIn && isDesignatedUsername(username);
}

/**
 * 白名单用户专属入口容器：非指定用户返回 null。
 * 可安全包住任意菜单项 / 设置分区 / 页面入口，不改动其余 UI。
 * 用法（无论最终埋在哪个菜单，都是同一行）：
 *   <DesignatedOnly><DropdownMenuItem onSelect={...}>…</DropdownMenuItem></DesignatedOnly>
 */
export function DesignatedOnly({ children }: { children: ReactNode }) {
  return useIsDesignatedUser() ? children : null;
}
