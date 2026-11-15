import "server-only";
/**
 * "What the draft will hold" for New invoice → From finished jobs.
 *
 * It runs the generator's OWN selection and line builders
 * (loadGeneratorJobs, buildGeneratorJobLines, loadGeneratorExtraLines,
 * combineGeneratorLines in client-invoices.ts) without writing anything, and
 * totals the lines with the generator's own totals function. Nothing here
 * reconstructs billing arithmetic: a job's amount is computeClientCharge's,
 * the totals are calculateShoppingAwareInvoiceTotals', and a job with no rate
 * has no amount (never $0).
 *
 * What it adds is read-only context the generator does not need: which jobs
 * in the period were left out (already on a live invoice, cancelled or a
 * skipped clean) and whether a job's fixed price carries a public holiday
 * rate snapshot.
 */
import { JobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { holidayRateSnapshotKey } from "@/lib/finance/holiday-rates";
import { calculateShoppingAwareInvoiceTotals } from "./shopping-client-charges";
import {
  billedJobLinesWhere,
  buildGeneratorJobLines,
  combineGeneratorLines,
  loadGeneratorExtraLines,
  loadGeneratorJobs,
  type ClientInvoiceGeneratorInput,
} from "./client-invoices";
import type { GeneratePreview, PreviewLeftOut, PreviewOtherLine, PreviewTotals } from "./client-invoice-generate-preview-types";

const LEFT_OUT_LIMIT = 50;

function totalsOf(lines: Array<{ category: string; lineTotal: number }>, gstEnabled: boolean): PreviewTotals | null {
  return lines.length > 0 ? calculateShoppingAwareInvoiceTotals(lines, gstEnabled) : null;
}

/** Jobs in the window the generator never bills: cancelled, or a skipped clean. */
async function excludedInPeriod(input: ClientInvoiceGeneratorInput): Promise<PreviewLeftOut[]> {
  if (!input.periodStart && !input.periodEnd) return [];
  const window = { ...(input.periodStart ? { gte: input.periodStart } : {}), ...(input.periodEnd ? { lte: input.periodEnd } : {}) };
  const where: Prisma.JobWhereInput = {
    property: { clientId: input.clientId, ...(input.propertyId ? { id: input.propertyId } : {}) },
    scheduledDate: window,
    OR: [{ status: JobStatus.CANCELLED }, { cleanSkipStatus: "SKIPPED" }],
  };
  const rows = await db.job.findMany({
    where,
    select: { id: true, jobNumber: true, status: true },
    orderBy: [{ scheduledDate: "asc" }],
    take: LEFT_OUT_LIMIT,
  });
  return rows.map((row) => ({
    jobId: row.id,
    jobNumber: row.jobNumber ?? null,
    reason: row.status === JobStatus.CANCELLED ? "CANCELLED" : "SKIPPED",
    invoiceNumber: null,
  }));
}

async function alreadyInvoiced(clientId: string, jobs: Array<{ id: string; jobNumber: string | null }>): Promise<PreviewLeftOut[]> {
  if (jobs.length === 0) return [];
  const lines = await db.clientInvoiceLine.findMany({
    where: { ...billedJobLinesWhere(clientId), jobId: { in: jobs.map((job) => job.id) } },
    select: { jobId: true, invoice: { select: { invoiceNumber: true } } },
  });
  const numberByJob = new Map(lines.map((line) => [line.jobId, line.invoice.invoiceNumber]));
  return jobs.slice(0, LEFT_OUT_LIMIT).map((job) => ({
    jobId: job.id,
    jobNumber: job.jobNumber,
    reason: "ALREADY_INVOICED",
    invoiceNumber: numberByJob.get(job.id) ?? null,
  }));
}

async function holidayRatedJobIds(jobIds: string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const rows = await db.appSetting.findMany({ where: { key: { in: jobIds.map(holidayRateSnapshotKey) } }, select: { value: true } });
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row.value as { state?: unknown; jobId?: unknown } | null;
    if (value && value.state === "APPLIED" && typeof value.jobId === "string") ids.add(value.jobId);
  }
  return ids;
}

export async function previewClientInvoiceGeneration(input: ClientInvoiceGeneratorInput): Promise<GeneratePreview> {
  const selection = await loadGeneratorJobs(input);
  const { client, settings, eligibleJobs, unInvoicedJobs, invoicedJobIds, chargeByJob } = selection;
  const lines = buildGeneratorJobLines(input, selection);
  const extras = await loadGeneratorExtraLines(input, client);
  const allLines = combineGeneratorLines(lines, extras);
  const gstEnabled = input.gstEnabled ?? settings.pricing.gstEnabled;

  const lineByJob = new Map(lines.map((line) => [line.jobId, line]));
  const holiday = await holidayRatedJobIds(unInvoicedJobs.map((job) => job.id));
  const invoicedJobs = eligibleJobs.filter((job) => invoicedJobIds.has(job.id)).map((job) => ({ id: job.id, jobNumber: job.jobNumber ?? null }));
  const [invoicedLeftOut, excluded] = await Promise.all([alreadyInvoiced(client.id, invoicedJobs), excludedInPeriod(input)]);

  const otherLines: PreviewOtherLine[] = [
    ...extras.shoppingLines.map((line) => ({ key: `shopping:${line.settlementId}`, kind: "SHOPPING" as const, description: line.description, amount: line.lineTotal })),
    ...extras.chargeLines.map((line, index) => ({ key: `charge:${line.shoppingClientChargeId}:${index}`, kind: "SHOPPING_CHARGE" as const, description: line.description, amount: line.lineTotal })),
    ...extras.maintenanceLines.map((line) => ({ key: `repair:${line.assignmentId}`, kind: "REPAIR" as const, description: line.description, amount: line.lineTotal })),
  ];

  return {
    client: { id: client.id, name: client.name },
    propertyId: input.propertyId ?? null,
    period: { start: input.periodStart?.toISOString() ?? null, end: input.periodEnd?.toISOString() ?? null },
    periodBasis: input.periodBasis === "SERVICE" ? "SERVICE" : "SCHEDULED",
    gstEnabled,
    jobs: unInvoicedJobs.map((job) => {
      const charge = chargeByJob.get(job.id);
      const line = lineByJob.get(job.id) ?? null;
      return {
        jobId: job.id,
        jobNumber: job.jobNumber ?? null,
        jobType: String(job.jobType),
        scheduledDate: job.scheduledDate.toISOString(),
        propertyId: job.property.id,
        propertyName: job.property.name,
        source: charge?.source ?? "MISSING",
        amount: line ? line.lineTotal : null,
        lineDescription: line?.description ?? null,
        note: job.invoiceNote?.trim() || null,
        holidayRate: charge?.source === "FIXED_JOB" && holiday.has(job.id),
        updatedAt: job.updatedAt.toISOString(),
      };
    }),
    unratedJobIds: unInvoicedJobs.filter((job) => chargeByJob.get(job.id)?.rateMissing).map((job) => job.id),
    otherLines,
    totals: totalsOf(allLines, gstEnabled),
    jobTotals: totalsOf(lines, gstEnabled),
    chargedJobCount: lines.length,
    lineCount: allLines.length,
    leftOut: [...invoicedLeftOut, ...excluded],
  };
}
