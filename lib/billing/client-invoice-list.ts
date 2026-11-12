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
import {
  OUTSTANDING_INVOICE_STATUSES,
  REDUCING_CREDIT_NOTES_SELECT,
  creditedAmountOf,
  invoiceAmountOwing,
  isFullyCredited,
} from "@/lib/finance/receivables";
import { FALLBACK_INVOICE_TIMEZONE, effectivePaymentTermsDays, invoiceDueDay, paymentTermsDaysFrom } from "./invoice-due";
import { readStoredXeroSync } from "./client-invoice-xero-sync-rules";
import { xeroExportFailureOf, xeroExportStateOf } from "./client-invoice-guards";
import { missingRateReports } from "./missing-rates";
import { OWING_SORT_MAX_ROWS, pageIdsByOwing } from "./client-invoice-owing-sql";
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
  /** The organisation default terms (an invoice may use its snapshot or its client's terms). */
  paymentTermsDays: number;
  /** Start of today in the organisation timezone: an invoice whose due instant is before it is overdue. */
  startOfToday: Date;
  /** Outstanding invoices past their own due day (per-invoice terms; see invoice-due.ts). */
  overdueIds: string[];
  /** Unexported invoices whose Xero reservation is PENDING (in flight or cut off). */
  pendingXeroIds: string[];
  /** Unexported invoices whose push FAILED (reason recorded; reservation kept). */
  failedXeroIds: string[];
  /** In Xero but never read back by the status pull. */
  uncheckedXeroIds: string[];
  /** Sent or part-paid invoices whose approved/sent credit notes cover them: nothing is owed. */
  fullyCreditedIds: string[];
};

export function startOfTodayIn(timezone: string, now: Date): Date {
  return fromZonedTime(`${formatInTimeZone(now, timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
}

type TermsContext = Omit<ListContext, "pendingXeroIds" | "failedXeroIds" | "uncheckedXeroIds" | "fullyCreditedIds" | "overdueIds">;

/** Timezone and the organisation's default terms, read from settings exactly as the PDF reads them. */
async function loadTermsContext(now: Date): Promise<TermsContext> {
  const settings = await getAppSettings();
  const timezone = settings.timezone || FALLBACK_INVOICE_TIMEZONE;
  const paymentTermsDays = paymentTermsDaysFrom(settings.invoicing?.defaultPaymentTermsDays);
  return { timezone, paymentTermsDays, startOfToday: startOfTodayIn(timezone, now) };
}

/**
 * Outstanding invoices whose due instant (created + their own terms) is before
 * the start of today: the same test as `invoiceDueDay(...) < today`, with the
 * terms resolved per invoice (snapshot, else client terms, else the default),
 * so it is done in SQL rather than as one cut-off date.
 */
async function loadOverdueIds(terms: TermsContext): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT i."id" FROM "ClientInvoice" i JOIN "Client" c ON c."id" = i."clientId"
    WHERE i."kind"::text = 'INVOICE'
      AND i."status"::text IN ('SENT', 'PART_PAID')
      AND i."createdAt" + (COALESCE(i."paymentTermsDays", c."paymentTermsDays", ${terms.paymentTermsDays}::double precision) * INTERVAL '1 day') < ${terms.startOfToday}`;
  return rows.map((row) => row.id);
}

/** The terms an invoice's due day uses (invoice-due.ts, effectivePaymentTermsDays). */
function rowTermsDays(invoice: { paymentTermsDays: number | null; client: { paymentTermsDays: number | null } }, context: TermsContext): number {
  return effectivePaymentTermsDays({
    invoiceTermsDays: invoice.paymentTermsDays,
    clientTermsDays: invoice.client.paymentTermsDays,
    organisationDefaultDays: context.paymentTermsDays,
  });
}

/** Ids of outstanding invoices that credit notes fully cover (see isFullyCredited). */
async function loadFullyCreditedIds(): Promise<string[]> {
  const credited = await db.clientInvoice.findMany({
    where: {
      kind: "INVOICE",
      status: { in: [...OUTSTANDING_INVOICE_STATUSES] as ClientInvoiceStatus[] },
      creditNotes: { some: REDUCING_CREDIT_NOTES_SELECT.where },
    },
    select: { id: true, totalAmount: true, paidAmount: true, creditNotes: REDUCING_CREDIT_NOTES_SELECT },
  });
  return credited
    .filter((row) => isFullyCredited({ ...row, creditedAmount: creditedAmountOf(row.creditNotes) }))
    .map((row) => row.id);
}

export async function loadListContext(now: Date): Promise<ListContext> {
  const terms = await loadTermsContext(now);
  const [pending, failed, unchecked, fullyCreditedIds, overdueIds] = await Promise.all([
    db.clientInvoice.findMany({
      where: { xeroInvoiceId: null, metadata: { path: ["xeroExportState"], equals: "PENDING" } },
      select: { id: true },
    }),
    db.clientInvoice.findMany({
      where: { xeroInvoiceId: null, metadata: { path: ["xeroExportState"], equals: "FAILED" } },
      select: { id: true },
    }),
    db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ClientInvoice"
      WHERE "xeroInvoiceId" IS NOT NULL AND ("metadata" IS NULL OR jsonb_typeof("metadata") <> 'object' OR "metadata"->'xeroSync' IS NULL)`,
    loadFullyCreditedIds(),
    loadOverdueIds(terms),
  ]);
  return {
    ...terms,
    pendingXeroIds: pending.map((row) => row.id),
    failedXeroIds: failed.map((row) => row.id),
    uncheckedXeroIds: unchecked.map((row) => row.id),
    fullyCreditedIds,
    overdueIds,
  };
}

function xeroWhere(filters: ClientInvoiceListFilters, context: ListContext): Prisma.ClientInvoiceWhereInput {
  switch (filters.xero) {
    case "pushed":
      return { OR: [{ xeroInvoiceId: { not: null } }, { xeroExportedAt: { not: null } }] };
    case "pending":
      return { id: { in: context.pendingXeroIds } };
    case "failed":
      return { id: { in: context.failedXeroIds } };
    case "unchecked":
      return { id: { in: context.uncheckedXeroIds } };
    case "none":
      return { xeroInvoiceId: null, xeroExportedAt: null, id: { notIn: [...context.pendingXeroIds, ...context.failedXeroIds] } };
    case "in-xero":
      return { xeroInvoiceId: { not: null }, metadata: { path: ["xeroSync", "state"], equals: "IN_XERO" } };
    case "paid-in-xero":
      return { xeroInvoiceId: { not: null }, metadata: { path: ["xeroSync", "state"], equals: "PAID_IN_XERO" } };
    case "needs-review":
      return { xeroInvoiceId: { not: null }, metadata: { path: ["xeroSync", "state"], equals: "NEEDS_REVIEW" } };
    case "unknown":
      return { xeroInvoiceId: { not: null }, metadata: { path: ["xeroSync", "state"], equals: "UNKNOWN" } };
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
        { clientReference: contains },
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
      { id: { in: [...context.pendingXeroIds, ...context.failedXeroIds] } },
    ],
  };
}

/** Sent or part-paid invoices past their due day; never a credit note or a fully credited invoice. */
export function overdueWhere(context: ListContext): Prisma.ClientInvoiceWhereInput {
  return {
    kind: "INVOICE",
    status: { in: [...OUTSTANDING_INVOICE_STATUSES] as ClientInvoiceStatus[] },
    // Past its own due day (per-invoice terms, resolved in SQL); never fully credited.
    id: { in: context.overdueIds, ...(context.fullyCreditedIds.length ? { notIn: context.fullyCreditedIds } : {}) },
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
    // Ordered in SQL by pageIdsByOwing; this fallback is never the primary key.
    owing: { totalAmount: dir },
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
  kind: true,
  clientReference: true,
  creditsInvoice: { select: { id: true, invoiceNumber: true } },
  creditNotes: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true }, orderBy: { createdAt: "asc" } },
  paymentTermsDays: true,
  client: { select: { id: true, name: true, email: true, paymentTermsDays: true } },
} satisfies Prisma.ClientInvoiceSelect;

type SelectedInvoice = Prisma.ClientInvoiceGetPayload<{ select: typeof ROW_SELECT }>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** PENDING covers an open reservation, in flight or FAILED (see xeroExportFailureOf for which). */
export function clientInvoiceXeroState(invoice: {
  xeroInvoiceId: string | null;
  xeroExportedAt: Date | string | null;
  metadata: unknown;
}): ClientInvoiceXeroState {
  if (invoice.xeroInvoiceId || invoice.xeroExportedAt) return "PUSHED";
  const state = xeroExportStateOf(invoice.metadata);
  return state === "PENDING" || state === "FAILED" ? "PENDING" : "NONE";
}

/** The stored Xero pull state for the row, or null when never checked. */
export function xeroSyncView(metadata: unknown): ClientInvoiceListRow["xeroSync"] {
  const stored = readStoredXeroSync(metadata);
  if (!stored) return null;
  return { state: stored.state, reason: stored.reason, xeroStatus: stored.xeroStatus, checkedAt: stored.checkedAt, lastReadAt: stored.lastReadAt };
}

function toRow(invoice: SelectedInvoice, context: TermsContext, missingRateJobs: number | null = null): ClientInvoiceListRow {
  const creditNote = invoice.kind === "CREDIT_NOTE";
  const creditedAmount = creditNote ? 0 : creditedAmountOf(invoice.creditNotes);
  const owingFacts = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, creditedAmount };
  const fullyCredited = !creditNote && isFullyCredited(owingFacts);
  const outstanding = !creditNote && !fullyCredited && (OUTSTANDING_INVOICE_STATUSES as readonly string[]).includes(invoice.status);
  const termsDays = rowTermsDays(invoice, context);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status as ClientInvoiceStatusValue,
    totalAmount: Number(invoice.totalAmount ?? 0),
    paidAmount: invoice.paidAmount ?? null,
    // A credit note is never owed; its approved/sent amount reduces its invoice.
    amountOwing: creditNote ? 0 : invoiceAmountOwing(owingFacts),
    periodStart: iso(invoice.periodStart),
    periodEnd: iso(invoice.periodEnd),
    sentAt: iso(invoice.sentAt),
    paidAt: iso(invoice.paidAt),
    paidDate: iso(invoice.paidDate),
    paymentMethod: invoice.paymentMethod,
    paymentReference: invoice.paymentReference,
    createdAt: invoice.createdAt.toISOString(),
    dueDate: invoiceDueDay(invoice.createdAt, termsDays, context.timezone),
    paymentTermsDays: termsDays,
    overdue: outstanding && invoice.createdAt.getTime() + termsDays * DAY_MS < context.startOfToday.getTime(),
    xeroInvoiceId: invoice.xeroInvoiceId,
    xeroExportedAt: iso(invoice.xeroExportedAt),
    xeroState: clientInvoiceXeroState(invoice),
    xeroPushFailure: invoice.xeroInvoiceId || invoice.xeroExportedAt ? null : xeroExportFailureOf(invoice.metadata),
    xeroSync: xeroSyncView(invoice.metadata),
    missingRateJobs: invoice.status === "DRAFT" ? missingRateJobs : null,
    client: { id: invoice.client.id, name: invoice.client.name, email: invoice.client.email ?? null },
    kind: creditNote ? "CREDIT_NOTE" : "INVOICE",
    clientReference: invoice.clientReference ?? null,
    creditedAmount,
    fullyCredited,
    credits: invoice.creditsInvoice ? { id: invoice.creditsInvoice.id, invoiceNumber: invoice.creditsInvoice.invoiceNumber } : null,
    creditedBy: invoice.creditNotes.map((note) => ({
      id: note.id,
      invoiceNumber: note.invoiceNumber,
      status: note.status as ClientInvoiceStatusValue,
      totalAmount: Number(note.totalAmount ?? 0),
    })),
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

/**
 * One page sorted by owing: the ids of the WHOLE filtered set, then one SQL
 * ORDER BY over the owing expression (client-invoice-owing-sql.ts), then the
 * page's rows in that order. Refused, not cut, above OWING_SORT_MAX_ROWS.
 */
async function findPageByOwing(where: Prisma.ClientInvoiceWhereInput, query: ListQuery<ClientInvoiceSort>): Promise<SelectedInvoice[]> {
  const matching = await db.clientInvoice.findMany({ where, select: { id: true }, take: OWING_SORT_MAX_ROWS + 1 });
  if (matching.length > OWING_SORT_MAX_ROWS) {
    throw new ListQueryError(`Sorting by Owing works on up to ${OWING_SORT_MAX_ROWS} invoices. Narrow the filters first.`, "filter");
  }
  const ids = await pageIdsByOwing({ ids: matching.map((row) => row.id), dir: query.dir, skip: query.skip, take: query.take });
  const rows = await db.clientInvoice.findMany({ where: { id: { in: ids } }, select: ROW_SELECT });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

async function findPage(where: Prisma.ClientInvoiceWhereInput, query: ListQuery<ClientInvoiceSort>): Promise<SelectedInvoice[]> {
  if (query.sort === "owing") return findPageByOwing(where, query);
  return db.clientInvoice.findMany({
    where,
    select: ROW_SELECT,
    orderBy: orderByFor(query.sort, query.dir),
    skip: query.skip,
    take: query.take,
  });
}

/** Missing-rate job counts for the DRAFT rows on a page (null when unreadable). */
async function draftMissingRates(invoices: SelectedInvoice[]): Promise<Map<string, number> | null> {
  const drafts = invoices.filter((invoice) => invoice.status === "DRAFT");
  if (drafts.length === 0) return new Map();
  try {
    const lines = await db.clientInvoiceLine.findMany({
      where: { invoiceId: { in: drafts.map((invoice) => invoice.id) }, jobId: { not: null } },
      select: { invoiceId: true, jobId: true },
    });
    const reports = await missingRateReports(
      drafts.map((invoice) => ({
        id: invoice.id,
        clientId: invoice.client.id,
        jobIds: lines.flatMap((line) => (line.invoiceId === invoice.id && line.jobId ? [line.jobId] : [])),
      })),
    );
    return new Map(Array.from(reports).map(([id, report]) => [id, report.unrated.length + report.missingJobIds.length]));
  } catch {
    return null;
  }
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
    findPage(where, input.query),
    countChips(base, context),
  ]);
  const missing = await draftMissingRates(invoices);
  return {
    ...listResponse(
      invoices.map((invoice) => toRow(invoice, context, missing ? missing.get(invoice.id) ?? 0 : null)),
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
  const row = toRow(invoice, terms);
  return { row, timezone: terms.timezone, paymentTermsDays: row.paymentTermsDays };
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
  const invoices = await findPage(where, {
    page: 1,
    pageSize: CLIENT_INVOICE_EXPORT_MAX_ROWS,
    sort: input.sort,
    dir: input.dir,
    skip: 0,
    take: CLIENT_INVOICE_EXPORT_MAX_ROWS,
  });
  return invoices.map((invoice) => toRow(invoice, context));
}

/** An amount we formatted ourselves: never a formula, even when negative. */
type CsvAmount = { amount: number };

function csvCell(value: string | number | CsvAmount | null | undefined): string {
  if (value === null || value === undefined) return "";
  // A credit note's "-50.00" is a number, not a formula, so it is not escaped.
  if (typeof value === "object") return value.amount.toFixed(2);
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
    "Xero check",
    "Xero check reason",
    "Kind",
    "Credits invoice",
    "Credited",
    "Client reference",
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
      { amount: row.totalAmount },
      row.paidAmount === null ? "" : { amount: row.paidAmount },
      { amount: row.amountOwing },
      row.xeroPushFailure ? "FAILED" : row.xeroState,
      row.xeroInvoiceId,
      row.xeroSync?.state ?? "",
      row.xeroSync?.reason ?? "",
      row.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice",
      row.credits?.invoiceNumber ?? "",
      { amount: row.creditedAmount },
      row.clientReference,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
