/**
 * "Raises an urgent stock need below N" — the follow-up half. The submit
 * route puts the counts that fell below their threshold on the submission's
 * durable follow-up receipt; this calls the existing urgent stock report
 * (lib/inventory/urgent-stock.ts) for each, reporter = the cleaner who
 * submitted, scoped by that submission.
 *
 *  - once per submission and item: the request id is derived from both, so a
 *    retry returns the need already raised instead of reporting again;
 *  - a failure is returned (and kept on the receipt by the caller), never
 *    swallowed, and never blocks or undoes the submission;
 *  - the count goes with the report as an observation, judged by the urgent
 *    stock rule (it updates on-hand only when nothing newer was recorded);
 *  - it raises a NEED. Nothing is ordered or bought.
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { reportUrgentStockFromSubmission } from "@/lib/inventory/urgent-stock";
import { queueDelivery } from "@/lib/notifications/queue-delivery";
import type { UrgentStockRequest } from "@/lib/forms/form-effects";

export type FormUrgentStock = {
  cleanerId: string;
  /** When the cleaner submitted the form (the count was made at or before this). */
  observedAt: string;
  requests: UrgentStockRequest[];
};

/** A stable UUID-shaped id for (submission, item): the urgent report's idempotency key. */
export function formUrgentRequestId(submissionId: string, itemId: string): string {
  const hex = createHash("sha256").update(`form-urgent-stock:${submissionId}:${itemId}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function formUrgentNote(request: UrgentStockRequest, submissionId: string): string {
  const unit = request.unit ? ` ${request.unit}` : "";
  return `Raised by the job form: "${request.label}" counted ${request.count}${unit}, below ${request.threshold}. Submission ${submissionId}.`;
}

export async function raiseFormUrgentStock(submissionId: string, input: FormUrgentStock): Promise<{ raised: number; errors: string[] }> {
  const errors: string[] = [];
  let raised = 0;
  for (const request of input.requests) {
    try {
      await reportUrgentStockFromSubmission({
        cleanerId: input.cleanerId,
        submissionId,
        report: {
          propertyId: await propertyOfSubmission(submissionId),
          itemId: request.itemId,
          requestId: formUrgentRequestId(submissionId, request.itemId),
          observedCount: request.count,
          purchaseQuantity: null,
          observedAt: input.observedAt,
          note: formUrgentNote(request, submissionId),
        },
      });
      raised += 1;
    } catch (error) {
      errors.push(`${request.itemName ?? request.itemId}: ${error instanceof Error ? error.message : "could not be raised"}`);
    }
  }
  return { raised, errors };
}

async function propertyOfSubmission(submissionId: string): Promise<string> {
  const row = await db.formSubmission.findUnique({ where: { id: submissionId }, select: { job: { select: { propertyId: true } } } });
  if (!row?.job?.propertyId) throw new Error("SUBMISSION_PROPERTY_MISSING");
  return row.job.propertyId;
}

/** Tell the office once that a form's urgent need could not be raised yet; enqueues an inbox notice only. */
export async function queueUrgentStockReview(input: { jobId: string; submissionId: string }) {
  await db.$transaction(async (tx) => {
    const recipients = await tx.user.findMany({ where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true }, select: { id: true, role: true } });
    await queueDelivery({ recipients, category: "shopping", jobId: input.jobId, web: {
      subject: "Urgent stock from a form needs review",
      body: "A job form counted stock below its urgent level, but the urgent need could not be raised yet. The submission is saved and this will be retried; check the property's stock.",
    } }, {
      tx, eventId: input.submissionId, eventKey: "submission.urgent_stock_review", entity: { type: "FormSubmission", id: input.submissionId }, actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" }, transports: ["INBOX"],
    });
  });
}
