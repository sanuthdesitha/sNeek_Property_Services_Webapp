import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role, JobStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listQaOutcomeApprovals } from "@/lib/qa/outcome-approvals";
import { awardLoyaltyForCompletedJob } from "@/lib/client/rewards";
import { scheduleJobFollowUps } from "@/lib/ops/follow-up-sequences";
import { logger } from "@/lib/logger";

/**
 * QA outcome approvals — jobs a failed inspection parked in QA_REVIEW.
 *
 * GET  lists the queue (jobs in QA_REVIEW that have a QA/ADMIN review),
 *      oldest scheduled date first — these block invoicing until approved.
 * POST approves outcomes: QA_REVIEW → COMPLETED with an audit trail, mirroring
 *      the completedAt stamp semantics of the admin job editor (stamp now only
 *      when not already set). Rework jobs and QA scores are untouched.
 */

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobs = await listQaOutcomeApprovals();
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

const approveSchema = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { jobIds } = approveSchema.parse(await req.json());

    const approved: string[] = [];
    const skipped: string[] = [];

    // Per-job: a failure (or a job that already moved on) must not abort the
    // rest of the batch — it is reported back as skipped instead.
    for (const jobId of Array.from(new Set(jobIds))) {
      try {
        const job = await db.job.findUnique({
          where: { id: jobId },
          select: { id: true, status: true, completedAt: true },
        });
        if (!job || job.status !== JobStatus.QA_REVIEW) {
          skipped.push(jobId);
          continue;
        }
        await db.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.COMPLETED,
            // Stamp completion now only the first time (mirrors the stamp
            // semantics in app/api/admin/jobs/[id]/route.ts).
            ...(job.completedAt ? {} : { completedAt: new Date() }),
          },
        });
        await db.auditLog.create({
          data: {
            userId: session.user.id,
            jobId,
            action: "QA_OUTCOME_APPROVED",
            entity: "Job",
            entityId: jobId,
            after: { from: JobStatus.QA_REVIEW, to: JobStatus.COMPLETED } as any,
          },
        });
        approved.push(jobId);
      } catch (err) {
        logger.error({ err, jobId }, "QA outcome approval failed for job");
        skipped.push(jobId);
      }
    }

    // Post-completion side effects, best-effort (same as the QA pass path in
    // app/api/admin/jobs/[id]/qa/route.ts) — never fail the approval response.
    if (approved.length > 0) {
      await Promise.allSettled(
        approved.flatMap((jobId) => [
          awardLoyaltyForCompletedJob(jobId),
          scheduleJobFollowUps(jobId),
        ])
      );
    }

    return NextResponse.json({ approved, skipped });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
