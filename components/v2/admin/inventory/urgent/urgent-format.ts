/** Display helpers for the Urgent needs tab. Pure; times in the organisation's zone. */
import { formatInTimeZone } from "date-fns-tz";
import type { EPillTone } from "@/components/v2/ui/pill";
import type { NeededByState } from "@/lib/inventory/urgent-stock-actions";
import type { UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";

const DAY = 86_400_000;

function dayKey(at: Date, timeZone: string) {
  return formatInTimeZone(at, timeZone, "yyyy-MM-dd");
}

function dayOffset(at: Date, now: Date, timeZone: string): number {
  return Math.round((Date.parse(`${dayKey(at, timeZone)}T00:00:00Z`) - Date.parse(`${dayKey(now, timeZone)}T00:00:00Z`)) / DAY);
}

export type NeededByLabel = { text: string; tone: EPillTone | null; srText?: string };

/** "Tomorrow 10:00 clean", "Fri 13 Nov", "Passed", or "–" when unknown. */
export function neededByLabel(iso: string | null, state: NeededByState, timeZone: string, now = new Date()): NeededByLabel {
  if (state === "closed") return { text: "–", tone: null, srText: "Closed" };
  if (state === "unknown" || !iso) return { text: "–", tone: null, srText: "No upcoming clean scheduled" };
  if (state === "passed") return { text: "Passed", tone: "bad" };
  const at = new Date(iso);
  const offset = dayOffset(at, now, timeZone);
  const time = formatInTimeZone(at, timeZone, "HH:mm");
  if (offset <= 0) return { text: `Today ${time} clean`, tone: "bad" };
  if (offset === 1) return { text: `Tomorrow ${time} clean`, tone: "bad" };
  return { text: formatInTimeZone(at, timeZone, "EEE d MMM"), tone: offset <= 3 ? "warn" : null };
}

export function reportedWhen(iso: string, timeZone: string, now = new Date()): string {
  const at = new Date(iso);
  const offset = dayOffset(at, now, timeZone);
  if (offset === 0) return `today ${formatInTimeZone(at, timeZone, "HH:mm")}`;
  if (offset === -1) return "yesterday";
  if (offset > -7) return formatInTimeZone(at, timeZone, "EEE");
  return formatInTimeZone(at, timeZone, "d MMM");
}

export const STAGE_TONE: Record<UrgentStockStage, EPillTone> = {
  REPORTED: "bad",
  ACKNOWLEDGED: "warn",
  ORDERED: "info",
  DELIVERED: "ok",
  PROPERTY_CONFIRMED: "neutral",
  ADMIN_RESOLVED: "neutral",
};

export function quantity(value: number | null, unit: string): string {
  return value === null ? "Unknown" : `${value} ${unit}`;
}
