import { Role, QaAssignmentStatus, type Prisma } from "@prisma/client";
import { assertNotSelfInspection } from "@/lib/qa/self-review";
import { db } from "@/lib/db";

/** Resolve authority from the stored assignment, never from an optional request id. */
export async function requireQaSubmitAssignment(input: {
  jobId: string; userId: string; roles: readonly Role[]; assignmentId?: string | null;
  amending?: boolean;
}, database: typeof db | Prisma.TransactionClient = db) {
  await assertNotSelfInspection(database, { jobId: input.jobId, candidateUserId: input.userId, isSelf: true });
  const privileged = input.roles.some(role => role === Role.ADMIN || role === Role.OPS_MANAGER);
  const assignment = await database.qaAssignment.findFirst({
    where: {
      jobId: input.jobId,
      ...(input.assignmentId ? { id: input.assignmentId } : {}),
      status: input.amending ? QaAssignmentStatus.IN_PROGRESS : {
        in: [QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS],
      },
      ...(!privileged ? {
        AND: [
          { OR: [{ assignedToId: input.userId }, { assignedToId: null }] },
          { OR: [{ pickedUpById: input.userId }, { pickedUpById: null, assignedToId: input.userId }] },
        ],
      } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!assignment) throw new Error("FORBIDDEN");
  return assignment;
}
