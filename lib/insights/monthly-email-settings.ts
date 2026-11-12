/**
 * Settings for the monthly Insights email (owner decision 2026-11-11, second
 * set item 6). Stored in the settings table under its own key, so saving it
 * can never disturb the main settings document; read through a sanitiser so a
 * bad or missing value is OFF, never "send to everyone".
 *
 * Pure parts (types, sanitise, schedule maths) are safe in the browser.
 */
import { formatInTimeZone } from "date-fns-tz";

export const INSIGHTS_EMAIL_SETTING_KEY = "insightsMonthlyEmail";
/** One row per month sent: created once, so a restart or a second worker cannot send twice. */
export const INSIGHTS_EMAIL_SENT_PREFIX = "insightsMonthlyEmailSent:";

export const INSIGHTS_EMAIL_SECTIONS = ["money", "work", "quality", "findings"] as const;
export type InsightsEmailSection = (typeof INSIGHTS_EMAIL_SECTIONS)[number];

export const INSIGHTS_EMAIL_SECTION_LABEL: Record<InsightsEmailSection, string> = {
  money: "Money (revenue and margin; only for recipients with finance access)",
  work: "Work (cleans, on time, actual vs planned hours)",
  quality: "Quality (rework rate)",
  findings: "Worth knowing (the rule-based findings)",
};

export const INSIGHTS_EMAIL_MAX_RECIPIENTS = 20;
/** Days 1–28 only, so every month has the day. */
export const INSIGHTS_EMAIL_MAX_DAY = 28;

export type InsightsEmailSettings = {
  enabled: boolean;
  /** User ids; each is re-checked at send time (ADMIN, or OPS_MANAGER with Insights access). */
  recipientIds: string[];
  /** Day of the month (1–28) and hour (0–23) in the organisation timezone. */
  dayOfMonth: number;
  hour: number;
  sections: InsightsEmailSection[];
};

export const DEFAULT_INSIGHTS_EMAIL_SETTINGS: InsightsEmailSettings = {
  enabled: false,
  recipientIds: [],
  dayOfMonth: 1,
  hour: 8,
  sections: [...INSIGHTS_EMAIL_SECTIONS],
};

function wholeNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** A stored value read safely: anything unrecognised falls back to the default (OFF). */
export function sanitizeInsightsEmailSettings(input: unknown): InsightsEmailSettings {
  const row = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const ids = Array.isArray(row.recipientIds)
    ? Array.from(new Set(row.recipientIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))))
    : [];
  const sections = Array.isArray(row.sections)
    ? INSIGHTS_EMAIL_SECTIONS.filter((section) => (row.sections as unknown[]).includes(section))
    : [...DEFAULT_INSIGHTS_EMAIL_SETTINGS.sections];
  return {
    enabled: row.enabled === true,
    recipientIds: ids.slice(0, INSIGHTS_EMAIL_MAX_RECIPIENTS),
    dayOfMonth: wholeNumber(row.dayOfMonth, 1, INSIGHTS_EMAIL_MAX_DAY, DEFAULT_INSIGHTS_EMAIL_SETTINGS.dayOfMonth),
    hour: wholeNumber(row.hour, 0, 23, DEFAULT_INSIGHTS_EMAIL_SETTINGS.hour),
    sections,
  };
}

/** yyyy-MM of the month before `monthKey`. */
export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export type DueMonth = { due: true; reportMonth: string } | { due: false; reason: string };

/**
 * Whether the email for the previous month is due at `now`: the configured day
 * and hour of the current month (organisation timezone) has been reached.
 * Whether it was already sent is the marker's job, not this function's.
 */
export function insightsEmailDue(settings: InsightsEmailSettings, now: Date, timezone: string): DueMonth {
  if (!settings.enabled) return { due: false, reason: "The monthly Insights email is switched off." };
  if (settings.recipientIds.length === 0) return { due: false, reason: "No recipients are chosen." };
  const monthKey = formatInTimeZone(now, timezone, "yyyy-MM");
  const day = Number(formatInTimeZone(now, timezone, "d"));
  const hour = Number(formatInTimeZone(now, timezone, "H"));
  if (day < settings.dayOfMonth || (day === settings.dayOfMonth && hour < settings.hour)) {
    return { due: false, reason: `Not yet: it goes on day ${settings.dayOfMonth} at ${String(settings.hour).padStart(2, "0")}:00.` };
  }
  return { due: true, reportMonth: previousMonthKey(monthKey) };
}
