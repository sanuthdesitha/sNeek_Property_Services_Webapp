/**
 * Formatting for the client Money tab. Plain module (server pages read it).
 * Amounts come from the server already computed by the money policies; this
 * only prints them.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { ClientMoneyRow, ClientMoneyState } from "@/lib/billing/client-portal-money";
import { shortCalendarDay } from "@/lib/billing/client-portal-money";

export const MONEY_TZ = "Australia/Sydney";

export type MoneyTone = "neutral" | "success" | "warning" | "danger" | "info";

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatAud(value: number | null | undefined): string {
  return AUD.format(Number(value ?? 0));
}

/** A history instant printed as a Sydney day, e.g. "8 Oct". */
export function sydneyDay(value: Date | string | null | undefined, pattern = "d MMM"): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, MONEY_TZ, pattern) : null;
}

/** Badge text and tone for one invoice row. "Paid" only for a recorded payment. */
export function moneyBadge(row: Pick<ClientMoneyRow, "state" | "dueDay" | "dueProvisional">): { label: string; tone: MoneyTone } {
  const state: ClientMoneyState = row.state;
  switch (state) {
    case "PAID":
      return { label: "Paid", tone: "success" };
    case "OVERDUE":
      return { label: "Overdue", tone: "danger" };
    case "DUE":
      return { label: "Due", tone: "warning" };
    case "NOT_SENT":
      return { label: "Not yet sent", tone: "info" };
    case "PART_PAID":
      return { label: "Part paid", tone: "warning" };
    case "CREDIT_NOTE":
      return { label: "Credit note", tone: "neutral" };
    case "FULLY_CREDITED":
      return { label: "Fully credited", tone: "neutral" };
    default:
      return { label: "Issued", tone: "neutral" };
  }
}

/** "Due 14 Nov", "Overdue since 14 Nov", or an honest unknown. */
export function dueLabel(row: Pick<ClientMoneyRow, "state" | "dueDay" | "dueProvisional">): string {
  if (!row.dueDay) return "Due date unavailable";
  const day = shortCalendarDay(row.dueDay);
  if (row.state === "OVERDUE") return `Overdue since ${day}`;
  return row.dueProvisional ? `Due ${day} (fixed when sent)` : `Due ${day}`;
}

/** "October" for a period inside one month, else "1 Oct – 31 Oct", else the issue day. */
export function periodLabel(row: Pick<ClientMoneyRow, "periodStart" | "periodEnd">): string | null {
  const start = sydneyDay(row.periodStart, "yyyy-MM");
  const end = sydneyDay(row.periodEnd, "yyyy-MM");
  if (start && end && start === end) return sydneyDay(row.periodStart, "MMMM");
  if (row.periodStart || row.periodEnd) {
    return `${sydneyDay(row.periodStart) ?? "…"} – ${sydneyDay(row.periodEnd) ?? "…"}`;
  }
  return null;
}

/** "11 cleans, 2 other items" from the invoice's own lines; null when not read. */
export function linesLabel(row: Pick<ClientMoneyRow, "cleanLineCount" | "otherLineCount">): string | null {
  if (row.cleanLineCount === null || row.otherLineCount === null) return null;
  const parts = [
    row.cleanLineCount > 0 ? `${row.cleanLineCount} clean${row.cleanLineCount === 1 ? "" : "s"}` : null,
    row.otherLineCount > 0 ? `${row.otherLineCount} other item${row.otherLineCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
