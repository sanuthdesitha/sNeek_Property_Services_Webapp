/**
 * Payment behaviour per client, from the existing receivables rules.
 *
 *  - Days to pay: for INVOICE rows marked PAID whose payment fell in the
 *    period (the received date `paidDate`, else the recorded `paidAt`), the
 *    Sydney calendar days from `sentAt` to that payment. An invoice with no
 *    sent date is excluded and counted ("no sent date recorded"), never 0.
 *  - Overdue now: owing on invoices the client-invoice list calls overdue
 *    (`overdueWhere`: sent or part paid, created before the payment-terms
 *    cutoff), with the owing amount from lib/finance/receivables
 *    (`invoiceAmountOwing`, credit notes applied, fully credited invoices not
 *    counted). This is a current figure, not a period one.
 *  - Terms: per invoice, from the one due-date rule (lib/billing/invoice-due:
 *    the snapshot taken at first send, else the client's own terms, else the
 *    organisation default), the same value the PDF and the overdue rule use.
 *    The slow-payer finding compares a client's days to pay with the terms
 *    their paid invoices carried.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadListContext, overdueWhere } from "@/lib/billing/client-invoice-list";
import { creditedAmountOf, REDUCING_CREDIT_NOTES_SELECT, summarizeReceivables } from "@/lib/finance/receivables";
import { effectivePaymentTermsDays } from "@/lib/billing/invoice-due";
import type { PeriodRange } from "@/lib/quality/period";
import { sydneyDateKey } from "@/lib/time/sydney-range";
import { buildMeasure, known, missing, roundTo, sum, tally, type Known } from "./measure";
import type { InsightsFilters } from "./load-facts";
import type { Measure } from "./types";

/** Paid invoices a company-level days-to-pay figure needs. */
export const MIN_PAID_INVOICES_SUMMARY = 3;
/** Per client: one paid invoice is that client's real figure (basis shown). */
export const MIN_PAID_INVOICES_ROW = 1;

export type PaidInvoiceFact = { clientId: string; days: Known<number>; termsDays: number };

export type ClientPayment = {
  clientId: string;
  daysToPay: Measure;
  overdueAud: number;
  overdueInvoices: number;
  /** Mean terms of the paid invoices in the basis; null when none. */
  termsDays: number | null;
};

export type ReceivablesFacts = {
  paymentTermsDays: number;
  paid: PaidInvoiceFact[];
  /** Names of every client with a paid or overdue invoice here. */
  clientNames: Map<string, string>;
  overdueByClient: Map<string, { owing: number; count: number }>;
};

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Sydney calendar days from sent to paid; missing without a sent date. */
export function daysToPay(sentAt: Date | null, paidOn: Date): Known<number> {
  if (!sentAt) return missing("no_sent_date");
  return known(Math.max(0, dayNumber(sydneyDateKey(paidOn)) - dayNumber(sydneyDateKey(sentAt))));
}

export function daysToPayMeasure(paid: readonly PaidInvoiceFact[], minBasis: number): Measure {
  const result = tally(paid.map((row) => row.days));
  const average = result.values.length > 0 ? roundTo(sum(result.values) / result.values.length, 1) : null;
  return buildMeasure(average, result.values.length, result.excluded, minBasis);
}

function paidInPeriod(range: PeriodRange): Prisma.ClientInvoiceWhereInput {
  const window = range.start ? { gte: range.start, lt: range.end } : { lt: range.end };
  return { OR: [{ paidDate: window }, { paidDate: null, paidAt: window }] };
}

export async function loadReceivablesFacts(
  range: PeriodRange,
  filters: InsightsFilters,
  now: Date = new Date(),
): Promise<ReceivablesFacts> {
  const context = await loadListContext(now);
  const clientWhere: Prisma.ClientInvoiceWhereInput = filters.clientId ? { clientId: filters.clientId } : {};
  const [paidRows, overdueRows] = await Promise.all([
    db.clientInvoice.findMany({
      where: { AND: [{ kind: "INVOICE", status: "PAID" }, paidInPeriod(range), clientWhere] },
      select: { clientId: true, sentAt: true, paidAt: true, paidDate: true, paymentTermsDays: true, client: { select: { name: true, paymentTermsDays: true } } },
    }),
    db.clientInvoice.findMany({
      where: { AND: [{ kind: "INVOICE" }, overdueWhere(context), clientWhere] },
      select: {
        clientId: true,
        totalAmount: true,
        paidAmount: true,
        creditNotes: REDUCING_CREDIT_NOTES_SELECT,
        client: { select: { name: true } },
      },
    }),
  ]);

  const clientNames = new Map<string, string>();
  for (const row of [...paidRows, ...overdueRows]) clientNames.set(row.clientId, row.client.name);
  const paid: PaidInvoiceFact[] = [];
  for (const row of paidRows) {
    const paidOn = row.paidDate ?? row.paidAt;
    if (!paidOn) continue;
    const termsDays = effectivePaymentTermsDays({
      invoiceTermsDays: row.paymentTermsDays,
      clientTermsDays: row.client.paymentTermsDays,
      organisationDefaultDays: context.paymentTermsDays,
    });
    paid.push({ clientId: row.clientId, days: daysToPay(row.sentAt, paidOn), termsDays });
  }

  const grouped = new Map<string, Array<{ totalAmount: number; paidAmount: number | null; creditedAmount: number }>>();
  for (const row of overdueRows) {
    const list = grouped.get(row.clientId) ?? [];
    list.push({ totalAmount: row.totalAmount, paidAmount: row.paidAmount, creditedAmount: creditedAmountOf(row.creditNotes) });
    grouped.set(row.clientId, list);
  }
  const overdueByClient = new Map<string, { owing: number; count: number }>();
  for (const [clientId, rows] of Array.from(grouped.entries())) {
    const summary = summarizeReceivables(rows);
    if (summary.outstandingCount > 0) overdueByClient.set(clientId, { owing: summary.outstandingAud, count: summary.outstandingCount });
  }
  return { paymentTermsDays: context.paymentTermsDays, paid, clientNames, overdueByClient };
}

export function clientPayment(facts: ReceivablesFacts, clientId: string): ClientPayment {
  const overdue = facts.overdueByClient.get(clientId);
  const paid = facts.paid.filter((row) => row.clientId === clientId);
  const counted = paid.filter((row) => row.days.reason === null);
  return {
    clientId,
    daysToPay: daysToPayMeasure(paid, MIN_PAID_INVOICES_ROW),
    overdueAud: overdue?.owing ?? 0,
    overdueInvoices: overdue?.count ?? 0,
    termsDays: counted.length ? roundTo(sum(counted.map((row) => row.termsDays)) / counted.length, 1) : null,
  };
}
