import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * NOBODY INSPECTS THEIR OWN CLEAN.
 *
 * The owner's rule, verbatim: "add a fail safe to not to assign the cleans they
 * do and do the QA themselves. never allows this."
 *
 * A version of this already existed — `mayAssignQa` in lib/maintenance —
 * enforced when somebody is given the QA hat on a MAINTENANCE ITEM. That guards
 * a different table. The rail that actually inspects and SCORES a clean is
 * `QaAssignment`, and it had no guard of any kind: not on admin assignment, not
 * on reassignment, and not on the self-claim paths where an inspector picks up
 * an open inspection themselves.
 *
 * NOT EXPLOITABLE TODAY, and that is worth stating plainly rather than dressing
 * it up. Job assignment requires `role: Role.CLEANER` and QA pickup requires
 * QA_INSPECTOR/OPS_MANAGER/ADMIN — disjoint sets, so no single account can
 * currently sit on both sides. The guard exists because MULTI-ROLE removes that
 * accident: the moment one person can hold CLEANER and QA_INSPECTOR, whoever
 * cleaned a property can claim its inspection, pass it, and invoice for the
 * inspection on top of the clean. Building the guard first is the difference
 * between a feature and an incident.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: self-review does not fail loudly. The
 * scores come out fine. Every quality figure downstream — the cleaner's
 * average, the property's history, the client's report — is then derived from
 * an inspection nobody independent ever did, and the corruption is invisible
 * precisely because nothing looks wrong.
 *
 * The predicate is pure so it can be tested without a database; the assert is
 * the thin database skin over it.
 */

/**
 * May this person inspect this clean?
 *
 * Deliberately the same shape as `mayAssignQa`, because it is the same rule.
 * Kept in a neutral home rather than imported from lib/maintenance: a QA
 * inspection has nothing to do with maintenance, and reaching across for the
 * predicate is how the next person concludes the maintenance module owns QA
 * policy.
 */
export function mayInspectClean(input: {
  candidateUserId: string;
  /** Everyone assigned to the job being inspected. */
  jobCleanerUserIds: readonly string[];
}): boolean {
  return !input.jobCleanerUserIds.includes(input.candidateUserId);
}

/** What an admin or inspector is told when the guard fires. */
export function selfReviewRefusalMessage(isSelf: boolean): string {
  return isSelf
    ? "You cleaned this job, so you cannot inspect it. Someone else has to take this one."
    : "That person cleaned this job, so they cannot inspect it. Pick a different inspector.";
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Refuse an inspection assignment or claim that would be self-review.
 *
 * Throws rather than silently skipping. A dropped assignment leaves an admin
 * believing the inspection is covered, and a silently-refused self-claim leaves
 * an inspector believing they have the job — both end with nobody inspecting it
 * and nobody knowing.
 *
 * `isSelf` shapes only the wording: one rule blocks both an admin assigning the
 * wrong person and an inspector claiming their own work.
 */
export async function assertNotSelfInspection(
  db: Db,
  input: { jobId: string; candidateUserId: string; isSelf?: boolean }
): Promise<void> {
  const cleaners = await db.jobAssignment.findMany({
    where: { jobId: input.jobId, removedAt: null },
    select: { userId: true },
  });

  const jobCleanerUserIds = cleaners.map((row) => row.userId);
  if (mayInspectClean({ candidateUserId: input.candidateUserId, jobCleanerUserIds })) return;

  throw new Error(selfReviewRefusalMessage(input.isSelf ?? false));
}
