type UsageStatsRange = "7d" | "30d" | "all";

export const USAGE_STATS_RANGE_DAYS: Record<Exclude<UsageStatsRange, "all">, number> =
  {
    "7d": 7,
    "30d": 30,
  };

export const USAGE_STATS_UNKNOWN_MODEL_KEY = "__unknown__";
