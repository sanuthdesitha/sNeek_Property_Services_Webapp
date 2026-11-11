/**
 * "Money this month" on Command. Read-only calls into the existing finance
 * functions; no arithmetic beyond adding the payroll engine's own per-cleaner
 * totals, exactly as the Finance hub does. Rows are omitted for a viewer
 * without the matching pack (finance for invoices, payroll for pay), and the
 * whole section is omitted server-side when neither applies.
 */
import { formatInTimeZone } from "date-fns-tz";
import { getClientInvoiceStats } from "@/lib/billing/client-invoice-stats";
import { getPayrollSummary } from "@/lib/finance/payroll";
import { getDashboardMetrics } from "@/lib/admin/dashboard";
import { viewerHasFeature, type CommandViewer } from "./command-viewer";
import { money } from "./command-sections";
import * as links from "./work-queue-links";
import type { MoneyPayload, MoneyRow } from "./command-types";

export function viewerSeesMoney(viewer: CommandViewer): boolean {
  return viewerHasFeature(viewer, "finance") || viewerHasFeature(viewer, "payroll");
}

async function invoiceRows(now: Date): Promise<MoneyRow[]> {
  const stats = await getClientInvoiceStats(now);
  const invoiced = stats.invoicedThisMonth;
  return [
    {
      // Owner decision 2026-11-11 (third set, item 4): first sent this month,
      // less credit notes sent this month, void excluded (client-invoice-stats).
      key: "invoiced", label: "Invoiced this month", value: money(invoiced.total),
      note: `${invoiced.invoiceCount} invoice${invoiced.invoiceCount === 1 ? "" : "s"} first sent since ${invoiced.monthStart}${invoiced.creditNoteCount > 0 ? `, less ${invoiced.creditNoteCount} credit note${invoiced.creditNoteCount === 1 ? "" : "s"}` : ""}`,
      href: "/v2/admin/finance?tab=invoices&status=active",
    },
    {
      key: "paid", label: "Paid this month", value: money(stats.paidThisMonth.total),
      note: `${stats.paidThisMonth.count} invoice${stats.paidThisMonth.count === 1 ? "" : "s"} recorded paid since ${stats.paidThisMonth.monthStart}`,
      href: "/v2/admin/finance?tab=invoices&status=PAID",
    },
    {
      key: "outstanding", label: "Outstanding", value: money(stats.outstanding.owing),
      badge: stats.outstanding.overdue > 0 ? { text: `${stats.outstanding.overdue} overdue`, tone: "warn" } : undefined,
      href: stats.outstanding.overdue > 0 ? links.INVOICES_OVERDUE_HREF : links.INVOICES_SENT_HREF,
    },
  ];
}

async function revenueTodayRow(): Promise<MoneyRow> {
  const metrics = await getDashboardMetrics({ strict: true });
  const missing = metrics.today.revenueRateMissingCount ?? 0;
  return {
    key: "today", label: missing > 0 ? "Known charges today" : "Revenue today", value: money(metrics.today.revenueAud),
    note: missing > 0 ? `Incomplete: ${missing} completed job${missing === 1 ? " has" : "s have"} no charge rate` : `${metrics.today.completed} completed`,
    href: missing > 0 ? "/v2/admin/pricing" : "/v2/admin/finance?tab=invoices",
  };
}

async function payRow(now: Date, timeZone: string): Promise<MoneyRow> {
  const monthStart = formatInTimeZone(now, timeZone, "yyyy-MM-01");
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const rows = await getPayrollSummary({ startDate: monthStart, endDate: today });
  const gross = rows.reduce((sum, row) => sum + row.totals.grossPay, 0);
  const missingRates = rows.reduce((sum, row) => sum + row.jobs.filter((job) => job.rateMissing).length, 0);
  return {
    key: "pay", label: "Cleaner pay due", value: money(gross),
    note: missingRates > 0
      ? `Month to date, gross. Excludes ${missingRates} job${missingRates === 1 ? "" : "s"} with no pay rate`
      : "Month to date, gross, from the payroll engine",
    href: links.PAYROLL_HREF,
  };
}

export async function loadCommandMoney(viewer: CommandViewer, now: Date, timeZone: string): Promise<MoneyPayload> {
  const rows: MoneyRow[] = [];
  const unavailable: string[] = [];
  const tasks: Array<{ name: string; run: () => Promise<MoneyRow | MoneyRow[]> }> = [];
  if (viewerHasFeature(viewer, "finance")) {
    tasks.push({ name: "Invoice totals", run: () => invoiceRows(now) });
    tasks.push({ name: "Today's charges", run: revenueTodayRow });
  }
  if (viewerHasFeature(viewer, "payroll")) tasks.push({ name: "Cleaner pay", run: () => payRow(now, timeZone) });
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") rows.push(...(Array.isArray(result.value) ? result.value : [result.value]));
    else unavailable.push(tasks[index].name);
  });
  return { rows, unavailable };
}
