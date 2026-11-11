/**
 * Server-side list of client invoices for the admin "Invoices and pay" screen.
 *
 * Replaces "newest 100, filtered in the browser": paging, sorting and every
 * filter run in the database, and the chip counts are real grouped totals under
 * the same non-status filters. Reads only; no invoice rule lives here.
 */
import { ClientInvoiceStatus, Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { invoiceAmountOwing, OUTSTANDING_INVOICE_STATUSES } from "@/lib/finance/receivables";
import { ListQueryError, listResponse, readQueryValue, type ListQuery } from "@/lib/admin/list-query";
import {
  CLIENT_INVOICE_STATUSES,
  CLIENT_INVOICE_STATUS_FILTERS,
  CLIENT_INVOICE_XERO_FILTERS,
  type ClientInvoiceCounts,
  type ClientInvoiceListFilters,
  type ClientInvoiceListPayload,
  type ClientInvoiceListRow,
  type ClientInvoiceSort,
  type ClientInvoiceStatusValue,
  type ClientInvoiceXeroState,
} from "./client-invoice-list-types";

const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Same fallback the PDF renderer uses when no terms are configured. */
const FALLBACK_PAYMENT_TERMS_DAYS = 14;

/** A real calendar day, not just the right shape (rejects 2026-13-01, 2026-02-30). */
const calendarDay = z
  .string()
  .regex(DATE_KEY)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const filterSchema = z.object({
  status: z.enum(CLIENT_INVOICE_STATUS_FILTERS).default("active"),
  clientId: z.string().min(1).max(64).nullable(),
  periodFrom: calendarDay.nullable(),
  periodTo: calendarDay.nullable(),
  xero: z.enum(CLIENT_INVOICE_XERO_FILTERS).default("any"),
  search: z.string().max(100).nullable(),
});

/** Reads the filter half of the query. Unknown values are refused, not ignored. */
export function parseClientInvoiceFilters(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): ClientInvoiceListFilters {
  const parsed = filterSchema.safeParse({
    status: readQueryValue(source, "status"),
    clientId: readQueryValue(source, "client") ?? null,
    periodFrom: readQueryValue(source, "from") ?? null,
    periodTo: readQueryValue(source, "to") ?? null,
    xero: readQueryValue(source, "xero"),
    search: readQueryValue(source, "q") ?? null,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ListQueryError(`Invalid invoice filter "${issue?.path.join(".") ?? "filter"}".`, "filter");
  }
  const filters = parsed.data;
  if (filters.periodFrom && filters.periodTo && filters.periodFrom > filters.periodTo) {
    throw new ListQueryError("The period start must be on or before the period end.", "filter");
  }
  return filters;
}

export type ListContext = {
  timezone: string;
  paymentTermsDays: number;
  /** Invoices created before this instant are past their printed due day. */
  overdueCreatedBefore: Date;
  /** Unexported invoices whose Xero reservation is PENDING (incl. failed pushes). */
  pendingXeroIds: string[];
};

export function startOfTodayIn(timezone: string, now: Date): Date {
  return fromZonedTime(`${formatInTimeZone(now, timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
}

type TermsContext = Omit<ListContext, "pendingXeroIds">;

/** Timezone and payment terms, read from settings exactly as the PDF reads them. */
async function loadTermsContext(now: Date): Promise<TermsContext> {
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const configuredTerms = settings.invoicing?.defaultPaymentTermsDays;
  const paymentTermsDays = typeof configuredTerms === "number" ? configuredTerms : FALLBACK_PAYMENT_TERMS_DAYS;
  return {
    timezone,
    paymentTermsDays,
    overdueCreatedBefore: new Date(startOfTodayIn(timezone, now).getTime() - paymentTermsDays * DAY_MS),
  };
}

export async function loadListContext(now: Date): Promise<ListContext> {
  const [terms, pending] = await Promise.all([
    loadTermsContext(now),
    db.clientInvoice.findMany({
      where: { xeroInvoiceId: null, metadata: { path: ["xeroExportState"], equals: "PENDING" } },
      select: { id: true },
    }),
  ]);
  return { ...terms, pendingXeroIds: pending.map((row) => row.id) };
}

function xeroWhere(filters: ClientInvoiceListFilters, context: ListContext): Prisma.ClientInvoiceWhereInput {
  switch (filters.xero) {
    case "pushed":
      return { OR: [{ xeroInvoiceId: { not: null } }, { xeroExportedAt: { not: null } }] };
    case "pending":
      return { id: { in: context.pendingXeroIds } };
    case "none":
      return { xeroInvoiceId: null, xeroExportedAt: null, id: { notIn: context.pendingXeroIds } };
    default:
      return {};
  }
}

/** Every filter except the status chip, so the chip counts share it. */
function baseWhere(filters: ClientInvoiceListFilters, context: ListContext): Prisma.ClientInvoiceWhereInput {
  const and: Prisma.ClientInvoiceWhereInput[] = [];
  if (filters.clientId) and.push({ clientId: filters.clientId });
  // The period filter matches the day the service period STARTS, read in the
  // organisation timezone. Manual drafts store UTC midnight and scheduled
  // drafts store local midnight; both read as the same start day locally, so
  // matching on the start keeps either kind in the month it was billed for.
  if (filters.periodFrom) {
    and.push({ periodStart: { gte: fromZonedTime(`${filters.periodFrom}T00:00:00`, context.timezone) } });
  }
  if (filters.periodTo) {
    and.push({ periodStart: { lte: fromZonedTime(`${filters.periodTo}T23:59:59.999`, context.timezone) } });
  }
  and.push(xeroWhere(filters, context));
  if (filters.search) {
    const contains = { contains: filters.search, mode: Prisma.QueryMode.insensitive };
    and.push({
      OR: [
        { invoiceNumber: contains },
        { client: { name: contains } },
        { client: { email: contains } },
      ],
    });
  }
  return { AND: and };
}

function needsActionWhere(context: ListContext): Prisma.ClientInvoiceWhereInput {
  return {
    OR: [
      { status: { in: [ClientInvoiceStatus.DRAFT, ClientInvoiceStatus.APPROVED] } },
      { id: { in: context.pendingXeroIds } },
    ],
  };
}

export function overdueWhere(context: ListContext): Prisma.ClientInvoiceWhereInput {
  return {
    status: { in: [...OUTSTANDING_INVOICE_STATUSES] as ClientInvoiceStatus[] },
    createdAt: { lt: context.overdueCreatedBefore },
  };
}

function statusWhere(filters: ClientInvoiceListFilters, context: ListContext): Prisma.ClientInvoiceWhereInput {
  switch (filters.status) {
    case "all":
      return {};
    case "active":
      return { status: { not: ClientInvoiceStatus.VOID } };
    case "needs-action":
      return needsActionWhere(context);
    case "overdue":
      return overdueWhere(context);
    default:
      return { status: filters.status as ClientInvoiceStatus };
  }
}

function orderByFor(sort: ClientInvoiceSort, dir: "asc" | "desc"): Prisma.ClientInvoiceOrderByWithRelationInput[] {
  const nullsLast = { sort: dir, nulls: "last" as const };
  const primary: Record<ClientInvoiceSort, Prisma.ClientInvoiceOrderByWithRelationInput> = {
    number: { invoiceNumber: dir },
    client: { client: { name: dir } },
    period: { periodStart: nullsLast },
    created: { createdAt: dir },
    sent: { sentAt: nullsLast },
    total: { totalAmount: dir },
    status: { status: dir },
    xero: { xeroExportedAt: nullsLast },
  };
  // The id tiebreaker keeps paging stable when many rows share a value.
  return [primary[sort], { id: "asc" }];
}

const ROW_SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  totalAmount: true,
  paidAmount: true,
  periodStart: true,
  periodEnd: true,
  sentAt: true,
  paidAt: true,
  paidDate: true,
  paymentMethod: true,
  paymentReference: true,
  createdAt: true,
  xeroInvoiceId: true,
  xeroExportedAt: true,
  metadata: true,
  client: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ClientInvoiceSelect;

type SelectedInvoice = Prisma.ClientInvoiceGetPayload<{ select: typeof ROW_SELECT }>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function clientInvoiceXeroState(invoice: {
  xeroInvoiceId: string | null;
  xeroExportedAt: Date | string | null;
  metadata: unknown;
}): ClientInvoiceXeroState {
  if (invoice.xeroInvoiceId || invoice.xeroExportedAt) return "PUSHED";
  const metadata = invoice.metadata;
  const state =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).xeroExportState
      : undefined;
  return state === "PENDING" ? "PENDING" : "NONE";
}

function toRow(invoice: SelectedInvoice, context: TermsContext): ClientInvoiceListRow {
  const dueAt = new Date(invoice.createdAt.getTime() + context.paymentTermsDays * DAY_MS);
  const outstanding = (OUTSTANDING_INVOICE_STATUSES as readonly string[]).includes(invoice.status);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status as ClientInvoiceStatusValue,
    totalAmount: Number(invoice.totalAmount ?? 0),
    paidAmount: invoice.paidAmount ?? null,
    amountOwing: invoiceAmountOwing(invoice),
    periodStart: iso(invoice.periodStart),
    periodEnd: iso(invoice.periodEnd),
    sentAt: iso(invoice.sentAt),
    paidAt: iso(invoice.paidAt),
    paidDate: iso(invoice.paidDate),
    paymentMethod: invoice.paymentMethod,
    paymentReference: invoice.paymentReference,
    createdAt: invoice.createdAt.toISOString(),
    dueDate: formatInTimeZone(dueAt, context.timezone, "yyyy-MM-dd"),
    overdue: outstanding && invoice.createdAt.getTime() < context.overdueCreatedBefore.getTime(),
    xeroInvoiceId: invoice.xeroInvoiceId,
    xeroExportedAt: iso(invoice.xeroExportedAt),
    xeroState: clientInvoiceXeroState(invoice),
    client: { id: invoice.client.id, name: invoice.client.name, email: invoice.client.email ?? null },
  };
}

function emptyStatusCounts(): Record<ClientInvoiceStatusValue, number> {
  return Object.fromEntries(CLIENT_INVOICE_STATUSES.map((status) => [status, 0])) as Record<
    ClientInvoiceStatusValue,
    number
  >;
}

async function countChips(base: Prisma.ClientInvoiceWhereInput, context: ListContext): Promise<ClientInvoiceCounts> {
  const [grouped, needsAction, overdue] = await Promise.all([
    db.clientInvoice.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.clientInvoice.count({ where: { AND: [base, needsActionWhere(context)] } }),
    db.clientInvoice.count({ where: { AND: [base, overdueWhere(context)] } }),
  ]);
  const byStatus = emptyStatusCounts();
  for (const group of grouped) {
    byStatus[group.status as ClientInvoiceStatusValue] = group._count._all;
  }
  const all = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  return { all, active: all - byStatus.VOID, needsAction, overdue, byStatus };
}

function whereFor(filters: ClientInvoiceListFilters, context: ListContext): Prisma.ClientInvoiceWhereInput {
  return { AND: [baseWhere(filters, context), statusWhere(filters, context)] };
}

export async function listClientInvoices(input: {
  query: ListQuery<ClientInvoiceSort>;
  filters: ClientInvoiceListFilters;
  now?: Date;
}): Promise<ClientInvoiceListPayload> {
  const context = await loadListContext(input.now ?? new Date());
  const base = baseWhere(input.filters, context);
  const where = whereFor(input.filters, context);
  const [total, invoices, counts] = await Promise.all([
    db.clientInvoice.count({ where }),
    db.clientInvoice.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFor(input.query.sort, input.query.dir),
      skip: input.query.skip,
      take: input.query.take,
    }),
    countChips(base, context),
  ]);
  return {
    ...listResponse(
      invoices.map((invoice) => toRow(invoice, context)),
      total,
      input.query,
    ),
    counts,
    paymentTermsDays: context.paymentTermsDays,
    today: formatInTimeZone(input.now ?? new Date(), context.timezone, "yyyy-MM-dd"),
  };
}

/**
 * One invoice in the list's row shape (due day, overdue, Xero state, owing),
 * for the editor page, so its actions use exactly the list's rules.
 */
export async function getClientInvoiceListRow(
  id: string,
  now: Date = new Date(),
): Promise<{ row: ClientInvoiceListRow; timezone: string; paymentTermsDays: number } | null> {
  const [terms, invoice] = await Promise.all([
    loadTermsContext(now),
    db.clientInvoice.findUnique({ where: { id }, select: ROW_SELECT }),
  ]);
  if (!invoice) return null;
  return { row: toRow(invoice, terms), timezone: terms.timezone, paymentTermsDays: terms.paymentTermsDays };
}

/** Upper bound on rows in one CSV export; larger exports are refused, not cut. */
export const CLIENT_INVOICE_EXPORT_MAX_ROWS = 5000;

/**
 * Rows for a CSV export: either the given ids, or everything matching the
 * filters. Refuses rather than truncating when the set is too large.
 */
export async function listClientInvoicesForExport(input: {
  filters: ClientInvoiceListFilters;
  ids: string[] | null;
  sort: ClientInvoiceSort;
  dir: "asc" | "desc";
  now?: Date;
}): Promise<ClientInvoiceListRow[]> {
  const context = await loadListContext(input.now ?? new Date());
  const where = input.ids ? { id: { in: input.ids } } : whereFor(input.filters, context);
  const total = await db.clientInvoice.count({ where });
  if (total > CLIENT_INVOICE_EXPORT_MAX_ROWS) {
    throw new ListQueryError(
      `This export would contain ${total} invoices. Narrow the filters to ${CLIENT_INVOICE_EXPORT_MAX_ROWS} or fewer.`,
      "filter",
    );
  }
  const invoices = await db.clientInvoice.findMany({
    where,
    select: ROW_SELECT,
    orderBy: orderByFor(input.sort, input.dir),
  });
  return invoices.map((invoice) => toRow(invoice, context));
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading formula character would execute in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function clientInvoicesCsv(rows: ClientInvoiceListRow[]): string {
  const header = [
    "Invoice number",
    "Client",
    "Client email",
    "Status",
    "Period start",
    "Period end",
    "Created",
    "Due (from payment terms)",
    "Sent",
    "Total",
    "Paid",
    "Owing",
    "Xero state",
    "Xero invoice ID",
  ];
  const lines = rows.map((row) =>
    [
      row.invoiceNumber,
      row.client.name,
      row.client.email,
      row.status,
      // Stored instants, unconverted: manual and scheduled drafts store their
      // period boundaries differently, so a reformatted day could shift.
      row.periodStart ?? "",
      row.periodEnd ?? "",
      row.createdAt,
      row.dueDate,
      row.sentAt ?? "",
      row.totalAmount.toFixed(2),
      row.paidAmount === null ? "" : row.paidAmount.toFixed(2),
      row.amountOwing.toFixed(2),
      row.xeroState,
      row.xeroInvoiceId,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
