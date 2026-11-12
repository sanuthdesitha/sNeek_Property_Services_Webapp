/**
 * "Add finished jobs" to an existing DRAFT (Wave D).
 *
 * Candidates are the draft client's finished jobs (COMPLETED or INVOICED
 * status, not a skipped clean) that are on no live invoice (the one invoiced
 * rule), inside or outside the draft's period, each with the charge the
 * generator would bill (computeClientCharge with the client's active rates and
 * the active price book) or "no rate".
 *
 * Adding runs under the invoice's row lock and the client's billing lock (the
 * generator's), re-reads every job, and refuses the whole request when a job
 * is no longer finished, belongs to another client, is already on a live
 * invoice or has no rate. Lines come from the generator's own builder
 * (invoice-job-lines.ts) and totals from the shared totals function; nothing
 * is approved or sent.
 */
import { JobStatus, type Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/lib/db";
import { computeClientCharge } from "@/lib/finance/job-money";
import { assertHolidayRateSnapshots } from "@/lib/finance/holiday-rates";
import { NOT_INVOICED_JOB_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import { calculateShoppingAwareInvoiceTotals } from "./shopping-client-charges";
import { buildJobInvoiceLine } from "./invoice-job-lines";
import { invoiceContentLock } from "./client-invoice-guards";
import { staleInvoiceRefusal } from "./client-invoice-stale-guard";
import { actionResult, type InvoiceActionResult, type InvoiceActor } from "./invoice-action-result";

export const ADD_JOBS_MAX = 100;
const CANDIDATE_LIMIT = 300;

export const addJobsSchema = z.object({
  jobIds: z.array(z.string().min(1).max(64)).min(1, "Choose at least one job.").max(ADD_JOBS_MAX),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export type UnbilledJobCandidate = {
  id: string;
  jobNumber: string | null;
  jobType: string;
  propertyName: string;
  /** The scheduled day in the organisation timezone (yyyy-MM-dd). */
  scheduledDay: string;
  /** The charge the generator would bill, or null when the job has no rate. */
  charge: number | null;
  inPeriod: boolean | null;
};

export type UnbilledJobsPayload = { total: number; jobs: UnbilledJobCandidate[]; truncated: boolean };

/** Finished jobs of this client on no live invoice (also the editor's "N not billed"). */
export function finishedUnbilledWhere(clientId: string): Prisma.JobWhereInput {
  return {
    status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
    cleanSkipStatus: { not: "SKIPPED" },
    property: { clientId },
    ...NOT_INVOICED_JOB_WHERE,
  };
}

type RateClient = Pick<Prisma.TransactionClient, "propertyClientRate" | "priceBook">;

async function rateTables(client: RateClient, clientId: string) {
  const [propertyRates, priceBook] = await Promise.all([
    client.propertyClientRate.findMany({ where: { property: { clientId }, isActive: true } }),
    client.priceBook.findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } }),
  ]);
  return { propertyRates, priceBook };
}

/** The draft client's finished unbilled jobs with the generator's charge. */
export async function listUnbilledJobsForInvoice(invoiceId: string, timezone: string): Promise<UnbilledJobsPayload | null> {
  const invoice = await db.clientInvoice.findUnique({ where: { id: invoiceId }, select: { clientId: true, periodStart: true, periodEnd: true } });
  if (!invoice) return null;
  const where = finishedUnbilledWhere(invoice.clientId);
  const [total, jobs, rates] = await Promise.all([
    db.job.count({ where }),
    db.job.findMany({
      where,
      select: { id: true, jobNumber: true, jobType: true, propertyId: true, fixedPrice: true, scheduledDate: true, property: { select: { name: true } } },
      orderBy: [{ scheduledDate: "desc" }, { id: "asc" }],
      take: CANDIDATE_LIMIT,
    }),
    rateTables(db, invoice.clientId),
  ]);
  const inPeriod = (date: Date) =>
    invoice.periodStart && invoice.periodEnd ? date >= invoice.periodStart && date <= invoice.periodEnd : null;
  return {
    total,
    truncated: total > jobs.length,
    jobs: jobs.map((job) => {
      const charge = computeClientCharge(job, rates);
      return {
        id: job.id,
        jobNumber: job.jobNumber ?? null,
        jobType: job.jobType,
        propertyName: job.property.name,
        scheduledDay: formatInTimeZone(job.scheduledDate, timezone, "yyyy-MM-dd"),
        charge: charge.rateMissing ? null : charge.amount,
        inPeriod: inPeriod(job.scheduledDate),
      };
    }),
  };
}

class Refused extends Error {
  constructor(readonly result: InvoiceActionResult) {
    super("refused");
  }
}

function refuse(error: string, status = 409): never {
  throw new Refused(actionResult({ error }, status));
}

export async function addJobsToInvoice(input: {
  invoiceId: string;
  jobIds: string[];
  expectedUpdatedAt?: string;
  actor: InvoiceActor;
}): Promise<InvoiceActionResult> {
  const jobIds = Array.from(new Set(input.jobIds));
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
      const invoice = await tx.clientInvoice.findUnique({ where: { id: input.invoiceId }, include: { lines: true } });
      if (!invoice) refuse("Invoice not found.", 404);
      const stale = staleInvoiceRefusal(invoice.updatedAt, input.expectedUpdatedAt);
      if (stale) throw new Refused(stale);
      const lock = invoiceContentLock(invoice);
      if (!lock.editable) refuse(lock.reason);
      if (invoice.status !== "DRAFT") refuse("Jobs can only be added while the invoice is a draft.");
      if (invoice.kind !== "INVOICE") refuse("A credit note does not bill jobs.");
      const metadata = invoice.metadata as Record<string, unknown> | null;
      if (metadata?.startedWorkReview) refuse("This draft carries a started-work review. Generate a new draft for further work.");

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-invoice:${invoice.clientId}`}))`;
      const jobs = await tx.job.findMany({
        where: { id: { in: jobIds }, ...finishedUnbilledWhere(invoice.clientId) },
        include: { property: { select: { name: true } } },
      });
      if (jobs.length !== jobIds.length) {
        const found = new Set(jobs.map((job) => job.id));
        const named = await tx.job.findMany({ where: { id: { in: jobIds.filter((id) => !found.has(id)) } }, select: { jobNumber: true, id: true } });
        const list = named.map((job) => job.jobNumber ?? job.id).join(", ") || "some jobs";
        refuse(`Not added: ${list} ${named.length === 1 ? "is" : "are"} no longer a finished, unbilled job of this client (already on a live invoice, not finished, or another client's). Refresh the list.`);
      }
      const rates = await rateTables(tx, invoice.clientId);
      const charges = new Map(jobs.map((job) => [job.id, computeClientCharge(job, rates)]));
      const unrated = jobs.filter((job) => charges.get(job.id)?.rateMissing);
      if (unrated.length) {
        refuse(`Not added: ${unrated.map((job) => job.jobNumber ?? job.id).join(", ")} ${unrated.length === 1 ? "has" : "have"} no client rate. Set rates in Billing rates first.`);
      }
      await assertHolidayRateSnapshots(tx, jobIds, Object.fromEntries(jobs.map((job) => [job.id, job.updatedAt])));

      let order = invoice.lines.reduce((max, line) => Math.max(max, line.sortOrder), 0);
      const created = jobs.flatMap((job) => {
        const line = buildJobInvoiceLine(job, charges.get(job.id), job.invoiceNote?.trim() || null);
        return line ? [{ ...line, invoiceId: invoice.id, sortOrder: (order += 1) }] : [];
      });
      await tx.clientInvoiceLine.createMany({ data: created });
      const lines = await tx.clientInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
      const totals = calculateShoppingAwareInvoiceTotals(lines, invoice.gstEnabled ?? true, { kind: invoice.kind });
      const updated = await tx.clientInvoice.update({
        where: { id: invoice.id },
        data: { subtotal: totals.subtotal, gstAmount: totals.gstAmount, totalAmount: totals.totalAmount },
        select: { id: true, updatedAt: true, totalAmount: true },
      });
      await tx.auditLog.create({
        data: {
          userId: input.actor.id,
          action: "CLIENT_INVOICE_JOBS_ADDED",
          entity: "ClientInvoice",
          entityId: invoice.id,
          after: { count: created.length, jobIds, jobNumbers: jobs.map((job) => job.jobNumber ?? job.id).join(", ") },
        },
      });
      return actionResult({ ok: true, added: created.length, updatedAt: updated.updatedAt.toISOString(), totalAmount: updated.totalAmount });
    });
  } catch (error) {
    if (error instanceof Refused) return error.result;
    const message = error instanceof Error && error.message ? error.message : "The jobs could not be added.";
    return actionResult({ error: message }, 409);
  }
}
