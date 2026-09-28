/**
 * Polaris 自有业务：供应商账号与额度（余额 / 周期套餐 / 按次套餐 / 用量）。
 *
 * 这是**我们自己的业务层**，与上游（ZCode / Z.ai）无关：
 * - 供应商以部署地址为配置项（见 quotaService 的 DEFAULT_QUOTA_BASE_URL / QUOTA_BASE_URL），
 *   换供应商只改配置，不改这一层的代码与文件名；
 * - 与上游套餐体系的残留（model-provider-family、usageEntitlement 等）零依赖。
 *
 * 字段口径以当前供应商的调用文档为准（首发为 Nimbus 中转站，换供应商以新文档为准）。
 * 文档原则："看不到的字段不要猜"，所以这里大量使用容错读法。
 */

/** 三类额度的统一视图：有套餐报套餐，无套餐报钱包。 */
export type QuotaViewKind = "credits" | "per_call" | "wallet";

export interface QuotaWalletInfo {
  /** 可用余额 = balance − frozen − pending_debt；判断"还能不能用"看它 */
  readonly available: number;
  /** 账面余额（含冻结），展示用 */
  readonly balance: number;
  /** 1 元 = N 积分（后台实时配置，禁止客户端写死汇率） */
  readonly creditsPerYuan: number;
  /** 今日已消费（积分） */
  readonly todaySpend: number;
  /** 本月已消费（积分） */
  readonly monthSpend: number;
  /** 是否低于低余额阈值 */
  readonly lowBalance: boolean;
  /** 充值总开关（false 时充值入口置灰） */
  readonly rechargeEnabled: boolean;
}

/** 周期积分套餐：额度 + 5 小时窗 + 周窗三道闸。 */
export interface QuotaCreditsSubscription {
  readonly kind: "credits";
  readonly id: number;
  readonly planName: string;
  readonly status: string;
  /** 本周期剩余可用额度 = 生效额度 − 已用 − 冻结 */
  readonly remaining: number;
  readonly creditsTotal: number;
  /** 5 小时窗口：已用 / 上限（null = 该套餐无此窗） */
  readonly used5h: number | null;
  readonly limit5h: number | null;
  /** 周窗口：已用 / 上限 */
  readonly usedWeekly: number | null;
  readonly limitWeekly: number | null;
  /** 距到期小时数（过期/取消为 0） */
  readonly hoursLeft: number;
  readonly expiresAt: number;
  /** 超限后是否回退钱包计费 */
  readonly fallbackToWallet: boolean;
  readonly autoRenew: boolean;
}

/** 按次套餐：剩余 N / 总 M 次；N 天有效期自首次调用起算。 */
export interface QuotaPerCallSubscription {
  readonly kind: "per_call";
  readonly id: number;
  readonly planName: string;
  readonly status: string;
  /** 剩余次数 = total_calls − calls_used（与 remainingCalls 同值，统一读法用） */
  readonly remaining: number;
  readonly remainingCalls: number;
  readonly totalCalls: number;
  readonly callsUsed: number;
  /** 未激活（首次使用才起算）时为 0 */
  readonly expiresAt: number;
  /** 距到期小时数（未激活为 0） */
  readonly hoursLeft: number;
  /** 周期天数（未激活文案用） */
  readonly periodDays: number | null;
}

export type QuotaSubscription = QuotaCreditsSubscription | QuotaPerCallSubscription;

export interface QuotaAccount {
  readonly username: string;
  readonly emailMasked: string | null;
  readonly wallet: QuotaWalletInfo;
}

/** 一次拉全量：账户 + 钱包 + 生效套餐 + 推荐额度视图（UI 面板一次刷新所需的全部）。 */
export interface QuotaStatus {
  readonly loggedIn: true;
  readonly account: QuotaAccount;
  /** 生效中的订阅（active/used_up），已按剩余额度降序 */
  readonly subscriptions: readonly QuotaSubscription[];
  /** 推荐展示的额度视图（有套餐报套餐，无套餐报钱包） */
  readonly quota: {
    readonly kind: QuotaViewKind;
    /** 剩余量（积分或次数） */
    readonly left: number;
    /** 总量（钱包视图无总量） */
    readonly total: number | null;
    /** 未激活的按次套餐（首次使用才起算有效期） */
    readonly notActivated: boolean;
  };
}

/** 未登录态：UI 据此渲染登录入口。 */
export interface QuotaLoggedOut {
  readonly loggedIn: false;
}

export type QuotaStatusResult = QuotaStatus | QuotaLoggedOut;

export interface QuotaUsageDay {
  /** 北京日 YYYY-MM-DD；空日期不补零，由前端按日历对齐 */
  readonly date: string;
  /** 当日请求数（后台可关，关=键不出现） */
  readonly requests: number | null;
  /** 当日消耗积分 */
  readonly charged: number | null;
  /** 缓存命中率 % */
  readonly cacheHitRate: number | null;
}
