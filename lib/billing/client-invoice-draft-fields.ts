/**
 * Bill to, Period and Due on a DRAFT (Wave D). Read only once approved or
 * later, and on a credit note only the period may change.
 *
 *   Bill to  — a draft with job lines may move to another client only when
 *              every job belongs to a property of that client; a line with a
 *              property (manual grouping, maintenance), a shopping allocation
 *              or a started-work snapshot ties the draft to its client, so the
 *              move is refused with the reason. A blank or manual-only draft
 *              moves freely. Both clients' billing locks are taken (the
 *              generator's lock) and the jobs are re-checked against live
 *              invoices, so the move can never put work on two invoices.
 *   Period   — two calendar days (organisation dates, stored as Sydney day
 *              boundaries like the generator); it never adds or removes lines,
 *              and warns when job lines fall outside it.
 *   Due      — payment terms in days stored on the invoice as an explicit
 *              override (null = the client's terms). The first send keeps it:
 *              termsSnapshotFor never overwrites a stored value.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { LIVE_INVOICE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import { sydneyDayBoundary } from "./period";

export const DRAFT_TERMS_MAX_DAYS = 365;

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date (YYYY-MM-DD).");

export const draftFieldsSchema = z.object({
  clientId: z.string().trim().min(1).max(64).optional(),
  period: z.object({ start: day, end: day }).optional(),
  /** null = use the client's terms; a number = this invoice's own terms. */
  paymentTermsDays: z.number().int().min(0).max(DRAFT_TERMS_MAX_DAYS).nullable().optional(),
});

export type DraftFieldsBody = z.infer<typeof draftFieldsSchema>;

export function draftFieldsRequested(body: DraftFieldsBody): boolean {
  return body.clientId !== undefined || body.period !== undefined || body.paymentTermsDays !== undefined;
}

type DraftLine = {
  jobId: string | null;
  propertyId: string | null;
  shoppingRunId: string | null;
  shoppingClientChargeId: string | null;
};

export type DraftFieldsInvoice = {
  id: string;
  status: string;
  kind: string;
  clientId: string;
  metadata: unknown;
  paymentTermsDays: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  lines: DraftLine[];
};

type FieldsClient = Pick<Prisma.TransactionClient, "client" | "job" | "clientInvoiceLine" | "$executeRaw">;

export type DraftFieldsOutcome =
  | { ok: true; data: Prisma.ClientInvoiceUncheckedUpdateInput; summary: string[]; warnings: string[] }
  | { ok: false; error: string; status: number };

function refuse(error: string, status = 409): DraftFieldsOutcome {
  return { ok: false, error, status };
}

function hasStartedWorkSnapshot(metadata: unknown): boolean {
  return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as Record<string, unknown>).startedWorkReview);
}

async function clientChange(tx: FieldsClient, invoice: DraftFieldsInvoice, clientId: string): Promise<DraftFieldsOutcome> {
  if (invoice.kind === "CREDIT_NOTE") return refuse("A credit note bills the client of the invoice it credits, so its Bill to cannot change.");
  const target = await tx.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, isActive: true } });
  if (!target) return refuse("That client was not found.", 400);
  if (!target.isActive) return refuse("That client is not active.", 400);
  if (hasStartedWorkSnapshot(invoice.metadata)) return refuse("This draft carries a started-work review for its client, so its Bill to cannot change. Generate a draft for the other client instead.");
  if (invoice.lines.some((line) => line.shoppingRunId || line.shoppingClientChargeId)) {
    return refuse("This draft has reviewed shopping charges for its client, so its Bill to cannot change.");
  }
  if (invoice.lines.some((line) => !line.jobId && line.propertyId)) {
    return refuse("A line on this draft is grouped under one of this client's properties. Clear its property, or remove it, before changing Bill to.");
  }
  // Both clients' billing locks, in a fixed order, as the generator takes them.
  for (const id of [invoice.clientId, clientId].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-invoice:${id}`}))`;
  }
  const jobIds = Array.from(new Set(invoice.lines.flatMap((line) => (line.jobId ? [line.jobId] : []))));
  if (jobIds.length) {
    const jobs = await tx.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true, property: { select: { clientId: true } } } });
    const foreign = jobs.filter((job) => job.property.clientId !== clientId);
    if (foreign.length || jobs.length !== jobIds.length) {
      const names = foreign.map((job) => job.jobNumber ?? job.id).join(", ");
      return refuse(`Every job on this draft must belong to ${target.name}. ${names ? `Not theirs: ${names}.` : "Some jobs could not be found."} Remove those lines first.`);
    }
    const elsewhere = await tx.clientInvoiceLine.findFirst({
      where: { jobId: { in: jobIds }, invoiceId: { not: invoice.id }, invoice: LIVE_INVOICE_WHERE },
      select: { invoice: { select: { invoiceNumber: true } } },
    });
    if (elsewhere) return refuse(`A job on this draft is already on ${elsewhere.invoice.invoiceNumber}. Remove it before changing Bill to.`);
  }
  return { ok: true, data: { clientId }, summary: [`bill to ${target.name}`], warnings: [] };
}

async function periodWarnings(tx: FieldsClient, invoice: DraftFieldsInvoice, start: Date, end: Date): Promise<string[]> {
  const jobIds = invoice.lines.flatMap((line) => (line.jobId ? [line.jobId] : []));
  if (!jobIds.length) return [];
  const outside = await tx.job.count({ where: { id: { in: jobIds }, OR: [{ scheduledDate: { lt: start } }, { scheduledDate: { gt: end } }] } });
  return outside ? [`${outside} job line${outside === 1 ? " is" : "s are"} scheduled outside this period. Lines were not added or removed.`] : [];
}

/** Validate and build the update for the requested draft fields. Call under the invoice's row lock. */
export async function draftFieldsUpdate(tx: FieldsClient, invoice: DraftFieldsInvoice, body: DraftFieldsBody): Promise<DraftFieldsOutcome> {
  if (invoice.status !== "DRAFT") return refuse("Bill to, period and due terms can only change while the invoice is a draft.");
  const data: Prisma.ClientInvoiceUncheckedUpdateInput = {};
  const summary: string[] = [];
  const warnings: string[] = [];
  if (body.clientId !== undefined && body.clientId !== invoice.clientId) {
    const moved = await clientChange(tx, invoice, body.clientId);
    if (!moved.ok) return moved;
    Object.assign(data, moved.data);
    summary.push(...moved.summary);
  }
  if (body.period) {
    if (body.period.start > body.period.end) return refuse("The period start must be on or before its end.", 400);
    const start = sydneyDayBoundary(body.period.start, "start")!;
    const end = sydneyDayBoundary(body.period.end, "end")!;
    data.periodStart = start;
    data.periodEnd = end;
    summary.push(`period ${body.period.start} to ${body.period.end}`);
    warnings.push(...(await periodWarnings(tx, invoice, start, end)));
  }
  if (body.paymentTermsDays !== undefined) {
    if (invoice.kind === "CREDIT_NOTE") return refuse("A credit note has nothing due, so it has no payment terms.", 400);
    data.paymentTermsDays = body.paymentTermsDays;
    summary.push(body.paymentTermsDays === null ? "due on the client's terms" : `due ${body.paymentTermsDays} days (this invoice's own terms)`);
  }
  return { ok: true, data, summary, warnings };
}
