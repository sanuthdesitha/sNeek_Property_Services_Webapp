/**
 * Display helpers for QA issues on the Quality hub: status tones and dates in
 * the organisation's timezone. Unknown statuses read neutral.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { EPillTone } from "@/components/v2/ui/pill";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { titleCaseKey } from "@/lib/quality/types";

export { titleCaseKey };

export function severityTone(severity: string | null | undefined): EPillTone {
  if (severity === "CRITICAL") return "bad";
  if (severity === "MAJOR") return "warn";
  return "neutral";
}

export function rectificationTone(status: string | null | undefined): EPillTone {
  switch (status) {
    case "FIXED_BY_QA":
    case "FIXED_BY_OTHER_CLEANER":
    case "FIXED_BY_MANAGER":
      return "ok";
    case "PENDING":
    case "RETURNED_TO_CLEANER":
      return "warn";
    case "NOT_FIXED":
    case "ESCALATED":
      return "bad";
    default:
      return "neutral";
  }
}

export function falseConfirmationTone(status: string | null | undefined): EPillTone {
  switch (status) {
    case "SUSPECTED":
      return "warn";
    case "CONFIRMED":
      return "bad";
    case "REJECTED":
      return "ok";
    default:
      return "neutral";
  }
}

/** A recorded instant in the organisation's timezone, e.g. "6 Nov 2026". */
export function formatIssueDate(value: string | Date | null | undefined, timeZone: string = SYDNEY_TZ): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return formatInTimeZone(date, timeZone, "d MMM yyyy");
}

/**
 * Compact form for the expanded cleaner row, as drawn ("6 Nov"): the year is
 * added only when it is not the current year in the organisation's timezone.
 */
export function formatIssueDayShort(value: string | Date | null | undefined, timeZone: string = SYDNEY_TZ, now: Date = new Date()): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  const sameYear = formatInTimeZone(date, timeZone, "yyyy") === formatInTimeZone(now, timeZone, "yyyy");
  return formatInTimeZone(date, timeZone, sameYear ? "d MMM" : "d MMM yyyy");
}

/** Hours since an instant, or null when it cannot be read. */
export function hoursSince(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3_600_000));
}

export function formatMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value);
}

/** Rectification evidence is a flat key array (no annotation layer). */
export function keyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((key): key is string => typeof key === "string" && key.length > 0);
}

/**
 * QA photo keys. `annotatedKey` is a TRANSPARENT overlay holding only QA's
 * marks, so the composite `flatKey` is preferred, then the original photo —
 * never the bare overlay.
 */
export function qaPhotoKeyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const record = entry as { flatKey?: unknown; key?: unknown };
        if (typeof record.flatKey === "string") return record.flatKey;
        if (typeof record.key === "string") return record.key;
      }
      return null;
    })
    .filter((key): key is string => typeof key === "string" && key.length > 0);
}
