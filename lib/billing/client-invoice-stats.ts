/**
 * The four figures above the client-invoice table. Each is a real aggregate of
 * stored data, and each label says what it counts:
 *   Ready to bill    — finished jobs (COMPLETED/INVOICED, not skipped) that are
 *                      on no live invoice (lib/invoicing/invoiced-job-rule). A count, not a dollar figure:
 *                      the charge depends on rates the generator resolves.
 *   Drafts to review — DRAFT invoices and their stored totals.
 *   Outstanding      — owing on SENT and PART_PAID invoices less payments and
 *                      approved/sent credit notes (lib/finance/receivables);
 *                      fully credited invoices are not counted. Overdue count
 *                      from the PDF's due-date rule.
 *   Drafts include draft credit notes, whose negative totals net the sum.
 *   Paid this month  — invoices whose status is PAID and whose paid stamp falls
 *                      in this calendar month (organisation timezone), as
 *                      recorded here. Nothing is read from Xero.
 *   Invoiced this month — (owner decision 2026-11-11, the lead's definition)
 *                      totals (incl. GST, as issued) of INVOICE documents FIRST
 *                      sent to the client this calendar month (organisation
 *                      timezone, `sentAt`, which a re-send never moves), less
 *                      CREDIT_NOTE documents sent this month; VOID documents
 *                      are excluded. Approved-but-unsent is not yet invoiced.
 */
import { ClientInvoiceStatus, JobStatus, type Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { getOutstandingReceivables, OUTSTANDING_INVOICE_STATUSES } from "@/lib/finance/receivables";
import { loadListContext, overdueWhere } from "./client-invoice-list";
import { NOT_INVOICED_JOB_WHERE } from "@/lib/invoicing/invoiced-job-rule";

export type ClientInvoiceStats = {
  readyToBill: { jobs: number; clients: number };
  drafts: { count: number; total: number };
  outstanding: {
    count: number;
    owing: number;
    overdue: number;
    oldest: { invoiceNumber: string; clientName: string; createdAt: string } | null;
  };
  paidThisMonth: { count: number; total: number; monthStart: string };
  invoicedThisMonth: InvoicedThisMonth;
};

export type InvoicedThisMonth = {
  /** Invoices sent less credit notes sent, incl. GST. */
  total: number;
  invoiceCount: number;
  invoiceTotal: number;
  creditNoteCount: number;
  /** Positive amount credited by credit notes sent this month. */
  creditTotal: number;
  monthStart: string;
};

/** Pure: the "Invoiced this month" figure from the two sent-in-month aggregates. */
export function invoicedThisMonthFrom(input: {
  invoices: { count: number; sum: number | null };
  creditNotes: { count: number; sum: number | null };
  monthStart: string;
}): InvoicedThisMonth {
  const invoiceTotal = Number((input.invoices.sum ?? 0).toFixed(2));
  // Credit notes store negative totals; their magnitude is what was credited.
  const creditTotal = Number(Math.abs(input.creditNotes.sum ?? 0).toFixed(2));
  return {
    total: Number((invoiceTotal - creditTotal).toFixed(2)),
    invoiceCount: input.invoices.count,
    invoiceTotal,
    creditNoteCount: input.creditNotes.count,
    creditTotal,
    monthStart: input.monthStart,
  };
}

/** Documents first sent to the client in [monthStart, nextMonthStart), never void. */
export function sentInMonthWhere(kind: "INVOICE" | "CREDIT_NOTE", monthStart: Date, nextMonthStart: Date): Prisma.ClientInvoiceWhereInput {
  return { kind, status: { not: ClientInvoiceStatus.VOID }, sentAt: { gte: monthStart, lt: nextMonthStart } };
}

function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

const READY_TO_BILL_JOB: Prisma.JobWhereInput = {
  status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
  cleanSkipStatus: { not: "SKIPPED" },
  // The shared rule: no line on a live invoice (not void, not fully credited).
  ...NOT_INVOICED_JOB_WHERE,
};

export async function getClientInvoiceStats(now = new Date()): Promise<ClientInvoiceStats> {
  const context = await loadListContext(now);
  const monthKey = formatInTimeZone(now, context.timezone, "yyyy-MM");
  const monthStart = fromZonedTime(`${monthKey}-01T00:00:00`, context.timezone);
  const nextMonthStart = fromZonedTime(`${nextMonthKey(monthKey)}-01T00:00:00`, context.timezone);
  const [readyJobs, readyClients, drafts, receivables, overdue, oldest, paid, sentInvoices, sentCredits] = await Promise.all([
    db.job.count({ where: READY_TO_BILL_JOB }),
    db.client.count({ where: { properties: { some: { jobs: { some: READY_TO_BILL_JOB } } } } }),
    db.clientInvoice.aggregate({
      where: { status: ClientInvoiceStatus.DRAFT },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    getOutstandingReceivables(),
    db.clientInvoice.count({ where: overdueWhere(context) }),
    db.clientInvoice.findFirst({
      where: {
        kind: "INVOICE",
        status: { in: [...OUTSTANDING_INVOICE_STATUSES] as ClientInvoiceStatus[] },
        ...(context.fullyCreditedIds.length ? { id: { notIn: context.fullyCreditedIds } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { invoiceNumber: true, createdAt: true, client: { select: { name: true } } },
    }),
    db.clientInvoice.aggregate({
      where: { kind: "INVOICE", status: ClientInvoiceStatus.PAID, paidAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    db.clientInvoice.aggregate({ where: sentInMonthWhere("INVOICE", monthStart, nextMonthStart), _count: { _all: true }, _sum: { totalAmount: true } }),
    db.clientInvoice.aggregate({ where: sentInMonthWhere("CREDIT_NOTE", monthStart, nextMonthStart), _count: { _all: true }, _sum: { totalAmount: true } }),
  ]);
  return {
    readyToBill: { jobs: readyJobs, clients: readyClients },
    drafts: { count: drafts._count._all, total: Number((drafts._sum.totalAmount ?? 0).toFixed(2)) },
    outstanding: {
      count: receivables.outstandingCount,
      owing: receivables.outstandingAud,
      overdue,
      oldest: oldest
        ? { invoiceNumber: oldest.invoiceNumber, clientName: oldest.client.name, createdAt: oldest.createdAt.toISOString() }
        : null,
    },
    paidThisMonth: {
      count: paid._count._all,
      total: Number((paid._sum.totalAmount ?? 0).toFixed(2)),
      monthStart: `${monthKey}-01`,
    },
    invoicedThisMonth: invoicedThisMonthFrom({
      invoices: { count: sentInvoices._count._all, sum: sentInvoices._sum.totalAmount },
      creditNotes: { count: sentCredits._count._all, sum: sentCredits._sum.totalAmount },
      monthStart: `${monthKey}-01`,
    }),
  };
}
