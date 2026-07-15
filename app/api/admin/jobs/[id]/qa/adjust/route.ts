import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { ratingForScore } from "@/lib/accountability/scoring";
import { recomputeJobQaOutcome } from "@/lib/qa/authority";
import { roundCents } from "@/lib/finance/job-money";
import { notifyScoreAdjusted } from "@/lib/notifications/accountability";

/**
 * Admin QA score adjustment (Phase 5a).
 *
 * POST re-scores a QAReview to a manually chosen value, keeping `rawScore`
 * untouched (the pre-adjustment computed value stays as an audit anchor). The
 * rating + passed flag are recomputed from the new score; any linked CRITICAL
 * QaIssue keeps the review on management-review routing when the setting is on.
 * A mandatory reason is stored on the review and audited, then the job's QA
 * outcome (status/completion) is re-derived from the authoritative review.
 */

const bodySchema = z.object({
  reviewId: z.string().cuid(),
  score: z.number(),
  reason: z.string().trim().min(1).max(4000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const review = await db.qAReview.findUnique({
      where: { id: body.reviewId },
      select: {
        id: true,
        jobId: true,
        score: true,
        rawScore: true,
        rating: true,
        passed: true,
        managementReview: true,
      },
    });
    if (!review || review.jobId !== params.id) {
      return NextResponse.json({ error: "Review not found for this job." }, { status: 404 });
    }

    const settings = await getAppSettings();
    const newScore = Math.min(100, Math.max(0, roundCents(body.score)));

    // Preserve the CRITICAL management-review routing regardless of the number.
    const criticalCount = await db.qaIssue.count({
      where: { qaReviewId: review.id, severity: "CRITICAL" },
    });
    const hasCritical =
      criticalCount > 0 && settings.accountability.scoring.criticalTriggersManagementReview;
    const rating = ratingForScore(newScore, settings.accountability.scoring, hasCritical);
    const passed = rating === "EXCELLENT" || rating === "PASS";

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.qAReview.update({
        where: { id: review.id },
        data: {
          score: newScore,
          rating,
          passed,
          managementReview: hasCritical,
          adjustmentReason: body.reason,
          editedById: session.user.id,
          editedAt: new Date(),
          // rawScore intentionally untouched.
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: review.jobId,
          action: "QA_SCORE_ADJUST",
          entity: "QAReview",
          entityId: review.id,
          before: {
            score: review.score,
            rating: review.rating,
            passed: review.passed,
            managementReview: review.managementReview,
          } as any,
          after: {
            score: row.score,
            rating: row.rating,
            passed: row.passed,
            managementReview: row.managementReview,
            reason: body.reason,
          } as any,
        },
      });

      return row;
    });

    await recomputeJobQaOutcome(review.jobId);

    // Fire-and-forget: tell the cleaner their score changed. Never affects the response.
    void (async () => {
      const primary = await db.jobAssignment.findFirst({
        where: { jobId: review.jobId, removedAt: null },
        orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
        select: { userId: true, job: { select: { property: { select: { name: true } } } } },
      });
      if (!primary?.userId) return;
      await notifyScoreAdjusted({
        jobId: review.jobId,
        cleanerId: primary.userId,
        newScore: updated.score,
        reason: body.reason,
        propertyName: primary.job?.property?.name ?? null,
      });
    })().catch(console.error);

    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not adjust score." }, { status });
  }
}
