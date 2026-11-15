/**
 * The New invoice period default (owner default 2026-11-14, pending owner
 * confirmation): the period starts the day after the client's last live
 * invoice ended and runs to today; with no earlier invoice (or one that ends
 * today or later) it starts on the 1st of this month. Calendar days in the
 * organisation timezone, never shifted by the viewer's browser.
 */
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { LIVE_INVOICE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import type { PeriodDefault } from "./client-invoice-generate-preview-types";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day after `dayKey` (yyyy-MM-dd), computed on the date alone. */
export function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

/** Pure: the default from the last invoice's end day (or none) and today. */
export function periodDefaultFrom(input: { todayKey: string; lastEndKey: string | null; lastInvoiceNumber: string | null }): PeriodDefault {
  if (!DAY_KEY.test(input.todayKey)) throw new Error("Unreadable organisation day.");
  const monthStart = `${input.todayKey.slice(0, 8)}01`;
  if (input.lastEndKey && DAY_KEY.test(input.lastEndKey)) {
    const start = nextDayKey(input.lastEndKey);
    if (start <= input.todayKey) {
      return { start, end: input.todayKey, source: "LAST_INVOICE", lastInvoiceNumber: input.lastInvoiceNumber, lastPeriodEnd: input.lastEndKey };
    }
  }
  return { start: monthStart, end: input.todayKey, source: "MONTH_START", lastInvoiceNumber: input.lastInvoiceNumber, lastPeriodEnd: input.lastEndKey };
}

export async function defaultInvoicePeriod(clientId: string, timeZone: string, now: Date = new Date()): Promise<PeriodDefault> {
  const last = await db.clientInvoice.findFirst({
    where: { clientId, ...LIVE_INVOICE_WHERE, periodEnd: { not: null } },
    orderBy: [{ periodEnd: "desc" }],
    select: { invoiceNumber: true, periodEnd: true },
  });
  return periodDefaultFrom({
    todayKey: formatInTimeZone(now, timeZone, "yyyy-MM-dd"),
    lastEndKey: last?.periodEnd ? formatInTimeZone(last.periodEnd, timeZone, "yyyy-MM-dd") : null,
    lastInvoiceNumber: last?.invoiceNumber ?? null,
  });
}
