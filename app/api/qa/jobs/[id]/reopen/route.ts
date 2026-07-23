import { NextRequest, NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { REOPEN_REASON_MIN_LENGTH, canReopenInspection, reopenMoneyWarnings } from "@/lib/qa/reopen";
import { collectReopenMoneyFacts } from "@/lib/qa/reopen-facts";
import { assertPendingNotInPayroll, guardInvariant } from "@/lib/qa/rework-invariants";

/**
 * REOPEN a submitted QA inspection so it can be amended (a wrong verdict, a
 * missed photo, a mis-scored item) and re-submitted.
 *
 * What it does: flips the COMPLETED QaAssignment back to IN_PROGRESS and writes
 * an AuditLog row naming the actor and their reason.
 *
 * What it deliberately does NOT do: touch money. Any rework job or
 * CleanerPayAdjustment this inspection produced is left exactly as it is — the
 * response carries the warnings (lib/qa/reopen.reopenMoneyWarnings) so the UI
 * can say so out loud before the operator commits. Reversing pay is an Approval
 * Center action; the destructive "wipe the QA and start over" path stays the
 * admin-only /api/admin/jobs/[id]/qa-reset route.
 *
 * Re-submitting afterwards UPDATES the existing QAReview (see the `reopen`
 * branch in app/api/qa/jobs/[id]/route.ts) rather than stacking a second review.
 */

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

const bodySchema = z.object({
  assignmentId: z.string().trim().min(1).optional().nullable(),
  reason: z.string().trim().min(REOPEN_REASON_MIN_LENGTH).max(2000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const body = bodySchema.parse(await req.json());

    const job = await db.job.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!job) return NextResponse.json({ error: "QA job not found." }, { status: 404 });

    // The assignment to reopen: the caller's, else the latest COMPLETED one.
    const assignment = body.assignmentId
      ? await db.qaAssignment.findFirst({ where: { id: body.assignmentId, jobId: params.id } })
      : await db.qaAssignment.findFirst({
          where: { jobId: params.id, status: QaAssignmentStatus.COMPLETED },
          orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
        });
    if (!assignment) {
      return NextResponse.json({ error: "No submitted inspection found for this job." }, { status: 404 });
    }

    const eligibility = canReopenInspection({
      actorUserId: session.user.id,
      actorRole: String(session.user.role),
      assignment: {
        status: String(assignment.status),
        assignedToId: assignment.assignedToId,
        pickedUpById: assignment.pickedUpById,
      },
      jobStatus: String(job.status),
      reason: body.reason,
    });
    if (!eligibility.ok) {
      return NextResponse.json(
        { error: eligibility.message, code: eligibility.code },
        { status: eligibility.code === "NOT_YOUR_INSPECTION" || eligibility.code === "ROLE_NOT_ALLOWED" ? 403 : 400 }
      );
    }

    // The review this reopen amends — the latest real QA inspection review.
    const review = await db.qAReview.findFirst({
      where: { jobId: params.id, kind: "QA" },
      orderBy: { createdAt: "desc" },
      select: { id: true, score: true, passed: true, rating: true },
    });

    const facts = await collectReopenMoneyFacts(params.id, review?.id ?? null);
    const warnings = reopenMoneyWarnings(facts);

    // MONEY GUARD. Reopening writes nothing to pay, but it re-opens a path that
    // can create pay on re-submit, so refuse to proceed on top of a corrupt
    // adjustment (invariant 5: nothing PENDING may carry a payroll run or an
    // approved amount). Violations are audited by guardInvariant and fatal.
    const adjustments = await db.cleanerPayAdjustment
      .findMany({
        where: { jobId: params.id },
        select: { status: true, approvedAmount: true, includedInPayrollRunId: true },
      })
      .catch(() => []);
    for (const adjustment of adjustments) {
      await guardInvariant(
        () =>
          assertPendingNotInPayroll({
            status: String(adjustment.status),
            approvedAmount: adjustment.approvedAmount,
            includedInPayrollRunId: adjustment.includedInPayrollRunId,
          }),
        { actorUserId: session.user.id, jobId: params.id, entity: "CleanerPayAdjustment", entityId: params.id }
      );
    }

    await db.$transaction(async (tx) => {
      await tx.qaAssignment.update({
        where: { id: assignment.id },
        data: {
          status: QaAssignmentStatus.IN_PROGRESS,
          completedAt: null,
          // The person amending it owns it while it is open again; the original
          // arrival check-in and on-site minutes are left untouched (they are
          // the evidence the first visit happened).
          pickedUpById: session.user.id,
          pickedUpAt: assignment.pickedUpAt ?? new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action: "QA_INSPECTION_REOPENED",
          entity: "QaAssignment",
          entityId: assignment.id,
          before: {
            assignmentStatus: String(assignment.status),
            completedAt: assignment.completedAt?.toISOString() ?? null,
            reviewId: review?.id ?? null,
            reviewScore: review?.score ?? null,
            reviewPassed: review?.passed ?? null,
            reviewRating: review?.rating ?? null,
          } as any,
          after: {
            assignmentStatus: QaAssignmentStatus.IN_PROGRESS,
            reason: body.reason,
            reopenedBy: session.user.id,
            moneyFacts: facts,
            warnings,
          } as any,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      assignmentId: assignment.id,
      /** Pass this back on submit — the re-submit updates this review in place. */
      amendingReviewId: review?.id ?? null,
      warnings,
      moneyFacts: facts,
    });
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not reopen this inspection." }, { status });
  }
}
