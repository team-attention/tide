// Domain-owned rate-limit window shape. Structurally mirrors the wire-level
// AgentRuntimeRateLimitDto, but the application layer must not depend on the
// contracts module — adapters map this 1:1 onto the DTO.
export interface RateLimitWindow {
  label?: string;
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: number;
}

const RATE_LIMIT_CONTAINER_KEYS = [
  "rateLimits",
  "rate_limits",
  "quota",
  "usage",
  "tokenUsage",
  "token_usage",
  // ACP (gemini/opencode) nests its quota under `_meta.quota` — descend it so the
  // 5h + weekly windows at `_meta.quota.rateLimits` are found, not just top-level shapes.
  "_meta",
];

const RATE_LIMIT_WINDOW_KEYS = [
  "primary",
  "secondary",
  "daily",
  "weekly",
  "monthly",
  "hourly",
  "window",
  "short",
  "long",
];

const RATE_LIMIT_ARRAY_KEYS = ["limits", "windows", "rateLimitWindows", "rate_limit_windows"];

export function rateLimitsFromProviderRecord(value: unknown): RateLimitWindow[] {
  return dedupeRateLimits(rateLimitsFromUnknown(value, new Set()));
}

function rateLimitsFromUnknown(
  value: unknown,
  seen: Set<Record<string, unknown>>,
): RateLimitWindow[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => rateLimitsFromUnknown(entry, seen));
  }
  if (!isRecord(value) || seen.has(value)) {
    return [];
  }
  seen.add(value);

  const parsed: RateLimitWindow[] = [];
  const direct = rateLimitWindowFromRecord(value);
  if (direct !== undefined) {
    parsed.push(direct);
  }

  for (const key of RATE_LIMIT_WINDOW_KEYS) {
    parsed.push(...rateLimitsFromUnknown(value[key], seen));
  }
  for (const key of RATE_LIMIT_ARRAY_KEYS) {
    parsed.push(...rateLimitsFromUnknown(value[key], seen));
  }
  for (const key of RATE_LIMIT_CONTAINER_KEYS) {
    parsed.push(...rateLimitsFromUnknown(value[key], seen));
  }

  return parsed;
}

function rateLimitWindowFromRecord(record: Record<string, unknown>): RateLimitWindow | undefined {
  const usedPercent = explicitPercent(record) ?? percentFromUsedAndLimit(record);
  const windowMinutes = minutesField(record);
  const resetsAt = timestampSecondsField(record);
  const label = stringField(record, [
    "label",
    "name",
    "limitName",
    "limit_name",
    "windowLabel",
    "window_label",
  ]);

  if (
    usedPercent === undefined &&
    windowMinutes === undefined &&
    resetsAt === undefined &&
    label === undefined
  ) {
    return undefined;
  }

  return {
    ...(label !== undefined ? { label } : {}),
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function explicitPercent(record: Record<string, unknown>): number | undefined {
  return numberField(record, [
    "usedPercent",
    "used_percent",
    "percentUsed",
    "percent_used",
    "usagePercent",
    "usage_percent",
    "usedPercentage",
    "used_percentage",
    "percent",
    "percentage",
  ]);
}

function percentFromUsedAndLimit(record: Record<string, unknown>): number | undefined {
  const used = numberField(record, ["used", "current", "consumed", "usage"]);
  const limit = numberField(record, ["limit", "max", "maximum", "total"]);
  if (used === undefined || limit === undefined || limit <= 0) {
    return undefined;
  }
  return Math.min(100, (used / limit) * 100);
}

function minutesField(record: Record<string, unknown>): number | undefined {
  const minutes = numberField(record, [
    "windowMinutes",
    "window_minutes",
    "intervalMinutes",
    "interval_minutes",
    "durationMinutes",
    "duration_minutes",
  ]);
  if (minutes !== undefined) {
    return minutes;
  }
  const seconds = numberField(record, [
    "windowSeconds",
    "window_seconds",
    "intervalSeconds",
    "interval_seconds",
    "durationSeconds",
    "duration_seconds",
  ]);
  if (seconds !== undefined) {
    return seconds / 60;
  }
  const millis = numberField(record, [
    "windowMs",
    "window_ms",
    "intervalMs",
    "interval_ms",
    "durationMs",
    "duration_ms",
  ]);
  if (millis !== undefined) {
    return millis / 60000;
  }
  return minutesFromWindowString(
    stringField(record, ["window", "interval", "duration", "period", "timeWindow", "time_window"]),
  );
}

function minutesFromWindowString(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "weekly" || normalized === "week" || normalized === "1w") {
    return 10080;
  }
  if (normalized === "daily" || normalized === "day" || normalized === "1d") {
    return 1440;
  }
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/);
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = match[2];
  if (unit === "m" || unit === "min" || unit === "minute" || unit === "minutes") {
    return amount;
  }
  if (unit === "h" || unit === "hr" || unit === "hour" || unit === "hours") {
    return amount * 60;
  }
  if (unit === "d" || unit === "day" || unit === "days") {
    return amount * 1440;
  }
  return amount * 10080;
}

function timestampSecondsField(record: Record<string, unknown>): number | undefined {
  const raw =
    numberField(record, [
      "resetsAt",
      "resets_at",
      "resetAt",
      "reset_at",
      "resetTime",
      "reset_time",
      "resetTimestamp",
      "reset_timestamp",
    ]) ??
    timestampFromString(
      stringField(record, [
        "resetsAt",
        "resets_at",
        "resetAt",
        "reset_at",
        "resetTime",
        "reset_time",
        "resetTimestamp",
        "reset_timestamp",
      ]),
    );
  if (raw === undefined) {
    return undefined;
  }
  return raw > 10_000_000_000 ? Math.round(raw / 1000) : raw;
}

function timestampFromString(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : undefined;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function dedupeRateLimits(limits: RateLimitWindow[]): RateLimitWindow[] {
  const seen = new Set<string>();
  const deduped: RateLimitWindow[] = [];
  for (const limit of limits) {
    const key = JSON.stringify(limit);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(limit);
  }
  return deduped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
