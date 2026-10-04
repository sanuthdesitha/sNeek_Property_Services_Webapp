import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { isTaxableCategory, type PayAdjustmentCategory } from "@/lib/finance/pay-categories";

type PayRequest = { title?: string; type?: "HOURLY" | "FIXED"; requestedHours?: number | null;
  requestedRate?: number | null; requestedAmount?: number | null; cleanerNote?: string;
  mediaKeys?: string[]; category?: PayAdjustmentCategory };

/** The caller holds the job lock. Reopening a clean must not create the same
 * pending/approved/rejected/paid request again. New requests belong in the
 * explicit pay-request workflow; previous decisions remain intact. */
export async function persistSubmissionPayRequestOnce(tx: Prisma.TransactionClient, input: {
  jobId: string; propertyId: string; cleanerId: string; request: PayRequest;
}): Promise<boolean> {
  const request = input.request;
  const identity = {
    title: request.title?.trim() || "Extra payment request",
    type: request.type === "HOURLY" ? "HOURLY" as const : "FIXED" as const,
    requestedHours: request.requestedHours ?? null,
    requestedRate: request.requestedRate ?? null,
    requestedAmount: Number(request.requestedAmount),
    cleanerNote: request.cleanerNote?.trim() || request.title?.trim() || null,
    category: request.category ?? "SERVICE",
  };
  const sourceKey = createHash("sha256").update(JSON.stringify([input.jobId, input.cleanerId, identity])).digest("hex");
  const existing = await tx.cleanerPayAdjustment.findFirst({ where: {
    jobId: input.jobId, cleanerId: input.cleanerId, scope: "JOB",
    OR: [{ source: "CLEANER_SUBMISSION", sourceKey }, { source: null, ...identity }],
  }, select: { id: true } });
  if (existing) return false;
  await tx.cleanerPayAdjustment.create({ data: {
    jobId: input.jobId, propertyId: input.propertyId, cleanerId: input.cleanerId, scope: "JOB",
    ...identity, taxable: isTaxableCategory(request.category),
    source: "CLEANER_SUBMISSION", sourceKey,
    attachmentKeys: request.mediaKeys?.length ? request.mediaKeys : undefined,
  } });
  return true;
}
