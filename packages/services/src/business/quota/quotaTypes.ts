/**
 * Polaris 自有业务：供应商账号与额度（余额 / 周期套餐 / 按次套餐 / 用量）。
 *
 * 这是**我们自己的业务层**，与上游（ZCode / Z.ai）无关：
 * - 供应商以部署地址为配置项（见 quotaService 的 resolveQuotaBaseUrl：开发=本地
 *   127.0.0.1:8000 / 打包=域名 / QUOTA_BASE_URL 可覆盖），换供应商只改配置，
 *   不改这一层的代码与文件名；
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
  /** 5h 窗下次重置时刻（毫秒；后端口径=窗口内最早用量滚出时刻，空窗为 0） */
  readonly next5hRefreshAt: number;
  /** 周窗下次重置时刻（毫秒；未锚定为 0 = 首次使用后开新窗） */
  readonly nextWeekResetAt: number;
  /** 距到期小时数（过期/取消为 0） */
  readonly hoursLeft: number;
  /** 到期时间戳（毫秒；后端 expires_at 的 Unix 秒已在 client 投影层归一，未激活为 0） */
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
  /** 未激活（首次使用才起算）时为 0；毫秒时间戳（同上已归一） */
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

/** 注册开关预检（GET /api/v1/user/register-status，公开端点）。 */
export interface QuotaRegisterStatus {
  /** 是否开放公开注册（false 时登录页隐藏注册入口） */
  readonly registerEnabled: boolean;
  /** 注册是否必须邮箱验证码（true 时注册表单渲染「邮箱 + 验证码」必填组） */
  readonly emailRequired: boolean;
}

/** 注册入参（POST /api/v1/user/register；emailCode 仅 emailRequired 时必传）。 */
export interface QuotaRegisterParams {
  readonly username: string;
  readonly password: string;
  /** 邀请码（可选；无效码服务端静默忽略，注册照常成功） */
  readonly inviteCode?: string;
  readonly email?: string;
  readonly emailCode?: string;
}

/** 忘记密码重置入参（POST /api/v1/user/password/reset）。 */
export interface QuotaPasswordResetParams {
  readonly email: string;
  /** 邮件里收到的 6 位数字重置码 */
  readonly code: string;
  readonly newPassword: string;
}

/** 充值下单回执（POST /api/v1/alipay/recharge 的投影）。 */
export interface QuotaRechargeOrderCreated {
  readonly orderNo: string;
  /** 支付宝当面付二维码 URL（桌面端用系统外链打开唤起支付宝） */
  readonly qrCode: string;
  /** 原金额（元） */
  readonly amount: number;
  /** 实付金额（元；用优惠码时小于 amount） */
  readonly payAmount: number;
  /** 预计入账积分 */
  readonly credits: number;
  readonly creditsPerYuan: number;
}

/** 充值订单状态（GET /api/v1/alipay/orders/{order_no} 的投影）。 */
export interface QuotaRechargeOrderStatus {
  /** pending | paid | closed */
  readonly status: string;
  readonly payAmount: number;
  readonly credits: number;
  /** 二维码 URL（「重新打开支付页」兜底用；缺失为 null） */
  readonly payUrl: string | null;
  /** 支付完成时刻（毫秒；未知为 0） */
  readonly paidAt: number;
}

/**
 * 全站灰纪念模式状态（GET /api/v1/user/notice 的 grayscale 嵌套对象）。
 * start/end 为服务器本地 "YYYY-MM-DD HH:mm" 原样透出；active 由后端按当前时间
 * 算好（前端零时区/解析逻辑），true 才挂全站灰阶。
 */
export interface QuotaNoticeGrayscale {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly active: boolean;
}

/**
 * 系统公告 + 全站灰纪念模式（GET /api/v1/user/notice，公开端点免登录）。
 * enabled=false 时 content 无意义；公告无独立 id，客户端以 content 哈希作版本标识。
 */
export interface QuotaNotice {
  readonly enabled: boolean;
  readonly content: string;
  readonly grayscale: QuotaNoticeGrayscale;
}

/**
 * 每日签到状态（GET /api/v1/user/checkin/status，JWT 鉴权）。
 * streak：已签今天则含今天；未签则为截至昨天的连签（今天签到后 +1）。
 * tomorrowCredits：保持连签的下一笔奖励；今天未签时恰等于今天签到可得的奖励。
 * 功能关闭（checkin_base_credits=0）时后端 403「签到未开启」。
 */
export interface QuotaCheckinStatus {
  readonly checkedInToday: boolean;
  readonly streak: number;
  readonly base: number;
  readonly streakBonus: number;
  readonly tomorrowCredits: number;
}

/** 签到回执（POST /api/v1/user/checkin，JWT 鉴权）；重复签到后端 409「今日已签到」。 */
export interface QuotaCheckinResult {
  /** 本次入账积分（base + 连签加成，已按封顶口径计算） */
  readonly credits: number;
  readonly streak: number;
  readonly tomorrowCredits: number;
}

/** 我的用量重置卡（GET /api/v1/user/reset-cards 的清单条目投影）。 */
export interface QuotaResetCard {
  readonly id: number;
  /** 作用窗口：'5h' | 'week' | 'period'（per_call 订阅下核销侧映射为 'calls'） */
  readonly window: string;
  /** 到期时间戳（毫秒；0 = 永久） */
  readonly expiresAt: number;
  readonly expired: boolean;
  /** 空串 = 可用；否则为不可用原因（冷却中/达日限/无套餐/过期/被禁用） */
  readonly blockedReason: string;
  /** 窗口冷却剩余分钟（0 = 不在冷却） */
  readonly cooldownLeftMin: number;
  /** 近 24h 已用次数 / 上限（null = 不限） */
  readonly dailyUsed: number;
  readonly dailyLimit: number | null;
}

/**
 * 组合展示标签（/v1/models 的 combo 条目，服务端白名单三值）：
 * 纯展示，不参与任何计费/能力判定。
 */
export type QuotaModelDisplayTag = "recommended" | "limited_time" | "peak_pricing";

/**
 * 限时折扣展示载荷（服务端已按当前时间判定生效才下发；starts_at 不下发）。
 * ends_at 为 unix 秒；客户端只做截止提示，不做本地时间判定。
 */
export interface QuotaModelPromo {
  readonly label: string;
  readonly note: string | null;
  readonly endsAt: number | null;
}

/**
 * 模型目录条目（GET /v1/models 与免登录 /app-updates/models 共用构建器）。
 * id 是唯一必填字段；展示元数据（multiplier/tags/promo）仅组合（combo）条目
 * 且服务端配置了才出现，直连模型不带 —— 容错读法，缺省即 undefined。
 */
export interface QuotaModelCatalogEntry {
  readonly id: string;
  /** 组合计费倍率（如 0.5 = 半价）；未配置组合级倍率时不下发。 */
  readonly multiplier: number | null;
  readonly tags: readonly QuotaModelDisplayTag[];
  readonly promo: QuotaModelPromo | null;
}
