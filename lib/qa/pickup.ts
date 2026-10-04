import { QaAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertNotSelfInspection } from "@/lib/qa/self-review";

export async function pickUpQaAssignment(input: { jobId: string; userId: string; earlyStartReason?: string | null }) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.jobId}))`;
    await assertNotSelfInspection(tx, { jobId: input.jobId, candidateUserId: input.userId, isSelf: true });
    const rows = await tx.qaAssignment.findMany({ where: {
      jobId: input.jobId, status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
    }, orderBy: { createdAt: "asc" } });
    if (rows.some(row => (row.assignedToId && row.assignedToId !== input.userId) || (row.pickedUpById && row.pickedUpById !== input.userId))) throw new Error("FORBIDDEN");
    const existing = rows[0];
    if (existing?.status === QaAssignmentStatus.IN_PROGRESS && existing.pickedUpById === input.userId) return { assignment: existing, unchanged: true };
    const assignment = existing
      ? await tx.qaAssignment.update({ where: { id: existing.id }, data: {
        status: QaAssignmentStatus.IN_PROGRESS, pickedUpById: input.userId, pickedUpAt: existing.pickedUpAt ?? new Date(),
        ...(input.earlyStartReason ? { earlyStartReason: input.earlyStartReason } : {}),
      } })
      : await tx.qaAssignment.create({ data: {
        jobId: input.jobId, status: QaAssignmentStatus.IN_PROGRESS, pickedUpById: input.userId,
        pickedUpAt: new Date(), earlyStartReason: input.earlyStartReason,
      } });
    return { assignment, unchanged: false };
  });
}
