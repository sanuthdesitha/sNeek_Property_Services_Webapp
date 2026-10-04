import type { Prisma } from "@prisma/client";

/** Original-cleaner QA offers must be answered through the explicit offer flow. */
export async function hasUnacceptedOriginalReworkOffer(tx: Prisma.TransactionClient, job: { reworkOfJobId?: string | null }, cleanerId: string) {
  if (!job.reworkOfJobId) return false;
  const original = await tx.jobAssignment.findFirst({ where: { jobId: job.reworkOfJobId, removedAt: null }, orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }], select: { userId: true } });
  if (original?.userId !== cleanerId) return false;
  const offer = await tx.qaAssignment.findFirst({ where: { jobId: job.reworkOfJobId }, orderBy: { createdAt: "desc" }, select: { reworkOfferStatus: true } });
  return !!offer?.reworkOfferStatus && !["NONE", "ACCEPTED"].includes(offer.reworkOfferStatus);
}
