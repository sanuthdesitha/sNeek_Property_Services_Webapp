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
};

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
  const [readyJobs, readyClients, drafts, receivables, overdue, oldest, paid] = await Promise.all([
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
  };
}
