import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Reset a job's QA and re-request an inspection. Clears any existing QA reviews
 * (so a mistaken/wrong submission is undone), reopens the QA assignment (or
 * creates one), and puts the job back to QA_REVIEW so it re-appears in the QA
 * queue for a fresh inspection. Works whether or not a review already exists.
 * INVOICED jobs are locked and cannot be reset.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status === JobStatus.INVOICED) {
      return NextResponse.json({ error: "This job is invoiced and locked — QA can't be reset." }, { status: 400 });
    }

    let deletedReviews = 0;
    let cancelledReworks = 0;
    let reversedDeductions = 0;
    let skippedPaidDeductions = 0;
    let startedReworksRemaining = 0;
    await db.$transaction(async (tx) => {
      const reviews = await tx.qAReview.findMany({ where: { jobId: params.id }, select: { id: true } });
      const reviewIds = reviews.map((r) => r.id);
      if (reviewIds.length > 0) {
        // Detach QA form submissions first so the delete doesn't violate the FK.
        await tx.qaFormSubmission.updateMany({
          where: { qaReviewId: { in: reviewIds } },
          data: { qaReviewId: null },
        });
        await tx.qAReview.deleteMany({ where: { id: { in: reviewIds } } });
        deletedReviews = reviewIds.length;
      }

      // Reopen any existing QA assignments so the job needs inspecting again.
      const assignments = await tx.qaAssignment.findMany({ where: { jobId: params.id }, select: { id: true } });
      if (assignments.length > 0) {
        await tx.qaAssignment.updateMany({
          where: { jobId: params.id },
          data: {
            status: QaAssignmentStatus.OPEN,
            assignedToId: null,
            pickedUpById: null,
            pickedUpAt: null,
            completedAt: null,
            onSiteStartedAt: null,
            onSiteEndedAt: null,
            onSiteMinutes: null,
          },
        });
      } else {
        // No assignment on record — create a fresh open one so it enters the queue.
        await tx.qaAssignment.create({
          data: { jobId: params.id, status: QaAssignmentStatus.OPEN, createdById: session.user.id },
        });
      }

      // Unwind reworks spawned from this (now-reset) failure.
      // Policy: only delete reworks that haven't been started yet; leave any
      // IN_PROGRESS/SUBMITTED/COMPLETED rework alone (don't discard real work).
      const reworks = await tx.job.findMany({
        where: { reworkOfJobId: params.id, isRework: true },
        select: { id: true, status: true },
      });
      const UNSTARTED = [JobStatus.UNASSIGNED, JobStatus.OFFERED, JobStatus.ASSIGNED];
      const unstartedReworks = reworks.filter((r) => UNSTARTED.includes(r.status));
      startedReworksRemaining = reworks.filter((r) => !UNSTARTED.includes(r.status)).length;

      for (const rw of unstartedReworks) {
        // FK-safe teardown (mirrors the job DELETE route) before removing the job.
        await tx.stockTx.deleteMany({ where: { submission: { jobId: rw.id } } });
        await tx.submissionMedia.deleteMany({ where: { submission: { jobId: rw.id } } });
        await tx.formSubmission.deleteMany({ where: { jobId: rw.id } });
        await tx.timeLog.deleteMany({ where: { jobId: rw.id } });
        await tx.jobAssignment.deleteMany({ where: { jobId: rw.id } });
        await tx.qaFormSubmission.deleteMany({ where: { jobId: rw.id } });
        await tx.qaReworkTransfer.deleteMany({ where: { jobId: rw.id } });
        await tx.qaAssignment.deleteMany({ where: { jobId: rw.id } });
        await tx.qAReview.deleteMany({ where: { jobId: rw.id } });
        await tx.mediaOverrideRequest.deleteMany({ where: { jobId: rw.id } });
        await tx.cleanerPayAdjustment.deleteMany({ where: { jobId: rw.id } });
        await tx.report.deleteMany({ where: { jobId: rw.id } });
        await tx.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId: rw.id } } });
        await tx.laundryTask.deleteMany({ where: { jobId: rw.id } });
        await tx.auditLog.deleteMany({ where: { jobId: rw.id } });
        await tx.job.delete({ where: { id: rw.id } });
      }
      cancelledReworks = unstartedReworks.length;

      // Reverse the cross-cleaner pay deduction booked on THIS job — but only the
      // unpaid ones (never rewrite a deduction already committed to a payroll
      // run), and only when no started rework still relies on it.
      if (cancelledReworks > 0 && startedReworksRemaining === 0) {
        const reversed = await tx.cleanerPayAdjustment.deleteMany({
          where: {
            jobId: params.id,
            approvedAmount: { lt: 0 },
            title: { startsWith: "Rework reassigned" },
            includedInPayrollRunId: null,
          },
        });
        reversedDeductions = reversed.count;
        skippedPaidDeductions = await tx.cleanerPayAdjustment.count({
          where: {
            jobId: params.id,
            approvedAmount: { lt: 0 },
            title: { startsWith: "Rework reassigned" },
            includedInPayrollRunId: { not: null },
          },
        });
      }

      // Back to QA_REVIEW so it re-surfaces in the QA queue; clear completion.
      await tx.job.update({
        where: { id: params.id },
        data: { status: JobStatus.QA_REVIEW, completedAt: null },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action: "QA_RESET_REREQUEST",
          entity: "Job",
          entityId: params.id,
          after: {
            deletedReviews,
            cancelledReworks,
            startedReworksRemaining,
            reversedDeductions,
            skippedPaidDeductions,
          } as any,
        },
      });
    });

    const warning =
      startedReworksRemaining > 0
        ? `${startedReworksRemaining} rework job(s) were already started and were left untouched — handle them manually.`
        : skippedPaidDeductions > 0
          ? `${skippedPaidDeductions} rework pay deduction(s) were already paid in a payroll run and were not reversed — adjust manually if needed.`
          : null;
    return NextResponse.json({
      ok: true,
      deletedReviews,
      cancelledReworks,
      reversedDeductions,
      skippedPaidDeductions,
      startedReworksRemaining,
      warning,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not reset QA." }, { status });
  }
}
