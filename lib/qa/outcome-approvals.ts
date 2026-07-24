/**
 * QA outcome approvals — the admin sign-off queue for failed inspections.
 *
 * When a QA inspection FAILS, the job is deliberately parked in QA_REVIEW
 * (app/api/qa/jobs/[id]/route.ts) so billing can't run until an admin reviews
 * the outcome. This helper lists those parked jobs (only ones that actually
 * HAVE a QA/ADMIN review — jobs still waiting for their inspection stay out)
 * so the Approval Center can present them for the "mark completed" decision.
 *
 * Shared by GET /api/admin/qa/outcomes and the /api/admin/all-approvals
 * aggregate so the queue rows and the tab count can never disagree.
 */
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { pickAuthoritativeReviews } from "@/lib/qa/review-dedupe";

export interface QaOutcomeApprovalRow {
  id: string;
  jobNumber: string;
  scheduledDate: Date;
  property: { name: string; suburb: string | null } | null;
  /** Names of the non-removed assigned cleaners. */
  cleaners: string[];
  /** The authoritative review (QA outranks ADMIN, newest within kind). */
  review: {
    id: string;
    score: number;
    passed: boolean;
    kind: string;
    createdAt: Date;
    cleanerAcknowledgedAt: Date | null;
  } | null;
  /**
   * A rework job spawned from this one is still open (not COMPLETED/INVOICED).
   * Advisory only — approving the outcome does not touch the rework.
   */
  openRework: boolean;
}

export async function listQaOutcomeApprovals(limit = 100): Promise<QaOutcomeApprovalRow[]> {
  const jobs = await db.job.findMany({
    where: {
      status: JobStatus.QA_REVIEW,
      qaReviews: { some: { kind: { in: ["QA", "ADMIN"] } } },
    },
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      property: { select: { name: true, suburb: true } },
      assignments: {
        where: { removedAt: null },
        select: { user: { select: { name: true, email: true } } },
      },
      qaReviews: {
        where: { kind: { in: ["QA", "ADMIN"] } },
        select: {
          id: true,
          jobId: true,
          score: true,
          passed: true,
          kind: true,
          createdAt: true,
          cleanerAcknowledgedAt: true,
        },
      },
      reworkChildren: {
        where: { status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] } },
        select: { id: true },
        take: 1,
      },
    },
    // Longest-waiting first — these jobs block invoicing.
    orderBy: { scheduledDate: "asc" },
    take: limit,
  });

  return jobs.map((job) => {
    const authoritative = pickAuthoritativeReviews(job.qaReviews)[0] ?? null;
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      scheduledDate: job.scheduledDate,
      property: job.property,
      cleaners: job.assignments
        .map((a) => a.user?.name ?? a.user?.email ?? null)
        .filter((name): name is string => Boolean(name)),
      review: authoritative
        ? {
            id: authoritative.id,
            score: authoritative.score,
            passed: authoritative.passed,
            kind: authoritative.kind,
            createdAt: authoritative.createdAt,
            cleanerAcknowledgedAt: authoritative.cleanerAcknowledgedAt,
          }
        : null,
      openRework: job.reworkChildren.length > 0,
    };
  });
}
