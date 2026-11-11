/**
 * Server-side list of payee (cleaner and QA inspector) invoices for the admin
 * "Invoices and pay" screen: paging, sorting, status chips with real grouped
 * counts, search, payee and period filters, the four stat cards and the CSV.
 * Reads only; no invoice rule lives here.
 */
import type { CleanerInvoiceSubmission, Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { ListQueryError, listResponse, readQueryValue, type ListQuery } from "@/lib/admin/list-query";
import { CLEANER_NEEDS_ACTION_STATUSES, type CleanerInvoiceStatus } from "./invoice-transitions";
import {
  CLEANER_INVOICE_STATUS_FILTERS,
  type CleanerInvoiceCounts,
  type CleanerInvoiceListPayload,
  type CleanerInvoiceRow,
  type CleanerInvoiceSort,
  type CleanerInvoiceStats,
  type CleanerInvoiceStatusFilter,
  type CleanerPayeeOption,
} from "./invoice-admin-list-types";

const TIMEZONE = "Australia/Sydney";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type CleanerInvoiceFilters = {
  status: CleanerInvoiceStatusFilter;
  cleanerId: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  search: string | null;
};

const filterSchema = z.object({
  status: z.enum(CLEANER_INVOICE_STATUS_FILTERS).default("needs-action"),
  cleanerId: z.string().min(1).max(64).nullable(),
  periodFrom: day.nullable(),
  periodTo: day.nullable(),
  search: z.string().max(100).nullable(),
});

export function parseCleanerInvoiceFilters(source: URLSearchParams): CleanerInvoiceFilters {
  const parsed = filterSchema.safeParse({
    status: readQueryValue(source, "status"),
    cleanerId: readQueryValue(source, "cleaner") ?? null,
    periodFrom: readQueryValue(source, "from") ?? null,
    periodTo: readQueryValue(source, "to") ?? null,
    search: readQueryValue(source, "q") ?? null,
  });
  if (!parsed.success) throw new ListQueryError(`Invalid filter "${parsed.error.issues[0]?.path.join(".") ?? "filter"}".`, "filter");
  if (parsed.data.periodFrom && parsed.data.periodTo && parsed.data.periodFrom > parsed.data.periodTo) {
    throw new ListQueryError("The period start must be on or before the period end.", "filter");
  }
  return parsed.data;
}

/** Search matches the invoice number or the payee's name or email. */
async function baseWhere(filters: CleanerInvoiceFilters): Promise<Prisma.CleanerInvoiceSubmissionWhereInput> {
  const and: Prisma.CleanerInvoiceSubmissionWhereInput[] = [];
  if (filters.cleanerId) and.push({ cleanerId: filters.cleanerId });
  // Invoices whose period starts in the range, read as Sydney calendar days.
  if (filters.periodFrom) and.push({ periodStart: { gte: fromZonedTime(`${filters.periodFrom}T00:00:00`, TIMEZONE) } });
  if (filters.periodTo) and.push({ periodStart: { lte: fromZonedTime(`${filters.periodTo}T23:59:59.999`, TIMEZONE) } });
  if (filters.search) {
    const contains = { contains: filters.search, mode: "insensitive" as const };
    const payees = await db.user.findMany({ where: { OR: [{ name: contains }, { email: contains }] }, select: { id: true }, take: 500 });
    and.push({ OR: [{ invoiceNumber: contains }, { cleanerId: { in: payees.map((user) => user.id) } }] });
  }
  return { AND: and };
}

function statusWhere(status: CleanerInvoiceStatusFilter): Prisma.CleanerInvoiceSubmissionWhereInput {
  if (status === "all") return {};
  if (status === "needs-action") return { status: { in: [...CLEANER_NEEDS_ACTION_STATUSES] } };
  return { status };
}

function orderBy(sort: CleanerInvoiceSort, dir: "asc" | "desc"): Prisma.CleanerInvoiceSubmissionOrderByWithRelationInput[] {
  const primary: Record<CleanerInvoiceSort, Prisma.CleanerInvoiceSubmissionOrderByWithRelationInput> = {
    number: { invoiceNumber: { sort: dir, nulls: "last" } },
    period: { periodStart: dir },
    submitted: { createdAt: dir },
    jobs: { jobCount: dir },
    hours: { hours: dir },
    total: { totalAmount: dir },
    status: { status: dir },
  };
  return [primary[sort], { id: "asc" }];
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function proofUrls(keys: Prisma.JsonValue | null): CleanerInvoiceRow["paidClaimedProofUrls"] {
  if (!Array.isArray(keys)) return [];
  return keys
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((key) => ({ key, url: publicUrl(key) }));
}

type Payee = { id: string; name: string | null; email: string | null; role: string | null };

/** The row shape the old GET returned, so every caller reads the same fields. */
export function toCleanerInvoiceRow(row: CleanerInvoiceSubmission, payee: Payee | undefined): CleanerInvoiceRow {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    cleanerId: row.cleanerId,
    cleanerName: payee?.name || payee?.email || "Payee",
    cleanerRole: payee?.role ?? null,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    hours: row.hours,
    totalAmount: row.totalAmount,
    jobCount: row.jobCount,
    status: row.status as CleanerInvoiceStatus,
    xeroBillId: row.xeroBillId,
    xeroExportedAt: iso(row.xeroExportedAt),
    lineData: row.lineData,
    createdAt: row.createdAt.toISOString(),
    paidAmount: row.paidAmount,
    paidBankAccount: row.paidBankAccount,
    paidNote: row.paidNote,
    paymentMethod: row.paymentMethod,
    paidDate: iso(row.paidDate),
    paidAt: iso(row.paidAt),
    paidClaimedAt: iso(row.paidClaimedAt),
    paidClaimedNote: row.paidClaimedNote,
    paidClaimedProofUrls: proofUrls(row.paidClaimedProofKeys),
    changesRequestedAt: iso(row.changesRequestedAt),
    changesRequestedNote: row.changesRequestedNote,
  };
}

export async function withPayees(rows: CleanerInvoiceSubmission[]): Promise<CleanerInvoiceRow[]> {
  const ids = Array.from(new Set(rows.map((row) => row.cleanerId)));
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, role: true } }) : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => toCleanerInvoiceRow(row, byId.get(row.cleanerId)));
}

async function countChips(base: Prisma.CleanerInvoiceSubmissionWhereInput): Promise<CleanerInvoiceCounts> {
  const grouped = await db.cleanerInvoiceSubmission.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const byStatus: Record<string, number> = {};
  for (const group of grouped) byStatus[group.status] = group._count._all;
  const all = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const needsAction = CLEANER_NEEDS_ACTION_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
  return { all, needsAction, byStatus };
}

export async function listCleanerInvoices(input: { query: ListQuery<CleanerInvoiceSort>; filters: CleanerInvoiceFilters }): Promise<CleanerInvoiceListPayload> {
  const base = await baseWhere(input.filters);
  const where = { AND: [base, statusWhere(input.filters.status)] };
  const [total, rows, counts] = await Promise.all([
    db.cleanerInvoiceSubmission.count({ where }),
    db.cleanerInvoiceSubmission.findMany({ where, orderBy: orderBy(input.query.sort, input.query.dir), skip: input.query.skip, take: input.query.take }),
    countChips(base),
  ]);
  return { ...listResponse(await withPayees(rows), total, input.query), counts };
}

export async function cleanerInvoiceStats(): Promise<CleanerInvoiceStats> {
  const [awaitingAction, awaiting, inXero, paid] = await Promise.all([
    db.cleanerInvoiceSubmission.count({ where: { status: { in: [...CLEANER_NEEDS_ACTION_STATUSES] } } }),
    db.cleanerInvoiceSubmission.aggregate({ where: { status: { in: ["SUBMITTED", "APPROVED"] } }, _sum: { totalAmount: true } }),
    db.cleanerInvoiceSubmission.count({ where: { status: "XERO_PUSHED" } }),
    db.cleanerInvoiceSubmission.count({ where: { status: "PAID" } }),
  ]);
  return { awaitingAction, awaitingValue: Number((awaiting._sum.totalAmount ?? 0).toFixed(2)), inXero, paid };
}

/** Every payee who has submitted at least one invoice, for the payee filter. */
export async function cleanerInvoicePayees(): Promise<CleanerPayeeOption[]> {
  const ids = await db.cleanerInvoiceSubmission.findMany({ distinct: ["cleanerId"], select: { cleanerId: true } });
  if (!ids.length) return [];
  const users = await db.user.findMany({
    where: { id: { in: ids.map((row) => row.cleanerId) } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  return users.map((user) => ({ id: user.id, name: user.name || user.email || "Payee", role: user.role ?? null }));
}

export const CLEANER_INVOICE_EXPORT_MAX_ROWS = 5000;

/** Rows for the CSV: the chosen ids, or everything matching the filters. Refuses rather than truncating. */
export async function listCleanerInvoicesForExport(input: { filters: CleanerInvoiceFilters; ids: string[] | null }): Promise<CleanerInvoiceRow[]> {
  const where = input.ids ? { id: { in: input.ids } } : { AND: [await baseWhere(input.filters), statusWhere(input.filters.status)] };
  const total = await db.cleanerInvoiceSubmission.count({ where });
  if (total > CLEANER_INVOICE_EXPORT_MAX_ROWS) {
    throw new ListQueryError(`This export would contain ${total} invoices. Narrow the filters to ${CLEANER_INVOICE_EXPORT_MAX_ROWS} or fewer.`, "filter");
  }
  const rows = await db.cleanerInvoiceSubmission.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return withPayees(rows);
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading formula character would execute in a spreadsheet; a plain
  // negative amount is a number, not a formula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function cleanerInvoicesCsv(rows: CleanerInvoiceRow[]): string {
  const header = ["Invoice number", "Payee", "Payee role", "Status", "Period start", "Period end", "Submitted", "Jobs", "Hours", "Total", "Paid", "Payment method", "Paid date", "Xero bill ID"];
  const lines = rows.map((row) =>
    [
      row.invoiceNumber, row.cleanerName, row.cleanerRole, row.status, row.periodStart, row.periodEnd, row.createdAt,
      row.jobCount, row.hours.toFixed(2), row.totalAmount.toFixed(2), row.paidAmount === null ? "" : row.paidAmount.toFixed(2),
      row.paymentMethod, row.paidDate, row.xeroBillId,
    ].map(csvCell).join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
