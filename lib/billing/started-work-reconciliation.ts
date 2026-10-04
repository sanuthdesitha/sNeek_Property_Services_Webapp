import type { Prisma } from "@prisma/client";
import { computeClientCharge } from "@/lib/finance/job-money";
import { hasStartedWorkEvidence, snapshotStartedWork, type StartedWorkSnapshot } from "./started-work-review";

export type StartedWorkReview = {
  version: 1;
  required: boolean;
  pricingPolicy: "PROVISIONAL_AGREED_PRICE";
  periodStart: string;
  periodEnd: string;
  preparedAt: string;
  jobs: Array<StartedWorkSnapshot & { agreedAmount: number }>;
  reviewedAt?: string;
  reviewedById?: string;
  evidenceNote?: string;
};
type Invoice = { status?: string; clientId: string; metadata: unknown; lines: Array<{ id: string; jobId: string | null; unitPrice: number; quantity: number; lineTotal: number }> };
export function readStartedWorkReview(metadata: unknown): StartedWorkReview | null {
  const value = (metadata as { startedWorkReview?: StartedWorkReview } | null)?.startedWorkReview;
  if (!value) return null;
  if (value.version !== 1 || !Array.isArray(value.jobs) || !Number.isFinite(new Date(value.periodStart).getTime()) || !Number.isFinite(new Date(value.periodEnd).getTime())) {
    throw new Error("Started-work review snapshot is invalid. Office reconciliation is required.");
  }
  return value;
}

export async function loadStartedWorkReview(invoice: Invoice, tx: Prisma.TransactionClient) {
  const review = readStartedWorkReview(invoice.metadata);
  if (!review) return null;
  const ids = invoice.lines.flatMap(line => line.jobId ? [line.jobId] : []);
  const [jobs, rates, priceBook] = await Promise.all([
    tx.job.findMany({ where: { id: { in: ids } }, include: { property: { select: { clientId: true } }, timeLogs: { select: { startedAt: true, stoppedAt: true } } } }),
    tx.propertyClientRate.findMany({ where: { property: { clientId: invoice.clientId }, isActive: true } }),
    tx.priceBook.findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } }),
  ]);
  if (jobs.length !== new Set(ids).size || jobs.some(job => job.property.clientId !== invoice.clientId || job.cleanSkipStatus === "SKIPPED")) {
    throw new Error("Invoice work was removed, skipped or moved to another client. Review the draft lines before reconciliation.");
  }
  const current = jobs.map(job => {
    if (!hasStartedWorkEvidence(job, new Date(review.periodEnd))) throw new Error("Started-work evidence changed. Review or remove the draft line before reconciliation.");
    const charge = computeClientCharge({ jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice }, { propertyRates: rates, priceBook });
    if (charge.rateMissing || charge.amount == null) throw new Error("A client rate is missing. Review the job billing rate before reconciliation.");
    const snapshot = snapshotStartedWork(job, new Date(review.periodStart), new Date(review.periodEnd));
    return { ...snapshot, agreedAmount: charge.amount, invoiceNote: [job.invoiceNote,
      snapshot.unfinishedAtCutoff ? "PROVISIONAL agreed client price: unfinished at period cutoff; office review required." : null,
      snapshot.priorPeriodCarryover ? "Prior-period uninvoiced work carried forward for review." : null,
    ].filter(Boolean).join("\n") || null };
  });
  const changedJobIds = current.filter(job => {
    const previous = review.jobs.find(old => old.jobId === job.jobId);
    const lines = invoice.lines.filter(line => line.jobId === job.jobId);
    return !previous || previous.updatedAt !== job.updatedAt || previous.agreedAmount !== job.agreedAmount || lines.length !== 1 || lines[0].quantity !== 1 || Number(lines[0].lineTotal) !== job.agreedAmount;
  }).map(job => job.jobId);
  if (review.jobs.some(job => !ids.includes(job.jobId))) changedJobIds.push(...review.jobs.filter(job => !ids.includes(job.jobId)).map(job => job.jobId));
  return { review, current, changedJobIds, requiresReview: review.required || changedJobIds.length > 0 };
}

export async function inspectStartedWorkReview(invoice: Invoice, tx: Prisma.TransactionClient) {
  const review = readStartedWorkReview(invoice.metadata);
  if (!review) return null;
  try {
    const state = await loadStartedWorkReview(invoice, tx);
    return state ? { requiresReview: state.requiresReview, changedJobIds: state.changedJobIds, jobs: state.current } : null;
  } catch (error) {
    return { requiresReview: true, changedJobIds: [], jobs: review.jobs, error: error instanceof Error ? error.message : "Office reconciliation required." };
  }
}

/** Manual financial actions must follow a current, explicit office review. */
export async function assertStartedWorkReviewed(invoice: Invoice, tx: Prisma.TransactionClient, allowDraftApproval = false) {
  const review = readStartedWorkReview(invoice.metadata);
  if (!review) return;
  if (review.required) throw new Error("This draft contains provisional started-work pricing. Reconcile and confirm the office review before approving, sending, recording payment or exporting.");
  // An explicitly approved/issued snapshot remains collectible. Subsequent job
  // changes are shown as correction flags, never automatic financial changes.
  if (invoice.status && invoice.status !== "DRAFT") return;
  if (!allowDraftApproval) throw new Error("Approve the reviewed draft before sending, recording payment or exporting it.");
  for (const id of Array.from(new Set(invoice.lines.flatMap(line => line.jobId ? [line.jobId] : []))).sort()) await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
  const state = await loadStartedWorkReview(invoice, tx);
  if (state?.requiresReview) throw new Error("Job completion or billing changed after review. Reconcile the draft again; issued invoices require a manual correction.");
}
