/**
 * Words for the Properties list columns, shared by the table, the cards, the
 * side panel and the CSV export so every surface says the same thing. Pure.
 */
import { formatInTimeZone } from "date-fns-tz";
import { sydneyRelativeDayLabel } from "@/lib/jobs/date-grouping";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { PORTFOLIO_FLAG_LABEL, QA_MIN_REVIEWED, type CalendarState, type NextClean, type PortfolioFlag, type QaFigure } from "./portfolio-options";

export type PillTone = "neutral" | "ok" | "warn" | "bad" | "info" | "gold";

/** "6 h", "40 min", "3 d" since an instant; null when unknown. */
export function ageLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function calendarLabel(state: CalendarState, now: Date): { text: string; tone: PillTone | null } {
  switch (state.kind) {
    case "not-linked":
      return { text: "Not linked", tone: null };
    case "never-synced":
      return { text: "Not synced yet", tone: "neutral" };
    case "syncing":
      return { text: "Syncing", tone: "info" };
    case "synced":
      return { text: "Synced", tone: "ok" };
    case "failed": {
      const age = ageLabel(state.since, now);
      return { text: age ? `Failed ${age}` : "Failed", tone: "bad" };
    }
  }
}

/** "synced 12 min ago" / "last failure 6 h ago" for the panel and the iCal card. */
export function calendarDetail(state: CalendarState, now: Date): string {
  if (state.kind === "synced") {
    const age = ageLabel(state.at, now);
    return age ? `synced ${age} ago` : "synced, time not recorded";
  }
  if (state.kind === "failed") return state.error ? `failed: ${state.error}` : "failed, no reason recorded";
  return calendarLabel(state, now).text.toLowerCase();
}

/** "Today 11:00", "Fri 13 Nov", "Tomorrow 09:30". The day is a Sydney calendar day, never shifted. */
export function nextCleanLabel(next: NextClean | null, now: Date): string {
  if (!next) return "None booked";
  const day = sydneyRelativeDayLabel(next.dayKey, now);
  return next.startTime && (day === "Today" || day === "Tomorrow") ? `${day} ${next.startTime}` : day;
}

export function qaLabel(qa: QaFigure): string {
  return qa.score === null ? "Not enough data" : String(qa.score);
}

export function qaBasis(qa: QaFigure): string {
  if (qa.score === null) {
    return qa.reviewed === 0
      ? "No reviewed cleans in the last 30 days"
      : `${qa.reviewed} reviewed ${qa.reviewed === 1 ? "clean" : "cleans"} in 30 days; needs ${QA_MIN_REVIEWED}`;
  }
  return `Average of ${qa.reviewed} reviewed cleans in the last 30 days`;
}

export const FLAG_TONE: Record<PortfolioFlag, PillTone> = {
  "sync-error": "bad",
  "key-lost": "bad",
  "linen-late": "warn",
  "care-due": "warn",
  "no-laundry-partner": "warn",
};

export function flagLabels(flags: readonly PortfolioFlag[]): string {
  return flags.length === 0 ? "None" : flags.map((flag) => PORTFOLIO_FLAG_LABEL[flag]).join(", ");
}

/** A history instant in the organisation timezone, e.g. "11 Nov 22:00". */
export function historyStamp(iso: string | null, timeZone: string = SYDNEY_TZ): string {
  if (!iso) return "Not recorded";
  return formatInTimeZone(new Date(iso), timeZone, "d MMM HH:mm");
}
