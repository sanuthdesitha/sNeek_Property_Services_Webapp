import { NextRequest, NextResponse } from "next/server";
import {
  CoachingRecordStatus,
  CoachingRecordType,
  FalseConfirmationStatus,
  PayAdjustmentScope,
  PayAdjustmentStatus,
  PayAdjustmentType,
  RectificationStatus,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  resolveRectificationBand,
  buildRectificationSourceKey,
} from "@/lib/accountability/rectification";
import { ratingForScore } from "@/lib/accountability/scoring";
import { recomputeJobQaOutcome } from "@/lib/qa/authority";
import { roundCents } from "@/lib/finance/job-money";

/**
 * Admin QA-issue action endpoint (Phase 5a).
 *
 * PATCH performs one of four actions in a single transaction, each writing an
 * inline AuditLog row:
 *   • rectify              — record how QA fixed the issue (+ QA rectification pay)
 *   • falseConfirmation    — confirm/reject a suspected false confirmation
 *   • escalate             — route the issue to a management-review coaching record
 *   • proposeDeduction     — propose a negative pay adjustment against the cleaner
 *
 * GET returns a single issue with the relations the admin detail UI needs.
 */

const rectifySchema = z.object({
  action: z.literal("rectify"),
  status: z.nativeEnum(RectificationStatus),
  minutes: z.number().int().min(0).max(100000).optional(),
  beforeKeys: z.array(z.string()).optional(),
  afterKeys: z.array(z.string()).optional(),
  rectifiedById: z.string().cuid().optional(),
});

const falseConfirmationSchema = z.object({
  action: z.literal("falseConfirmation"),
  decision: z.enum(["CONFIRMED", "REJECTED"]),
});

const escalateSchema = z.object({
  action: z.literal("escalate"),
  reason: z.string().trim().min(1).max(4000),
});

const proposeDeductionSchema = z.object({
  action: z.literal("proposeDeduction"),
  amount: z.number().positive(),
  note: z.string().trim().max(4000).optional(),
});

const bodySchema = z.discriminatedUnion("action", [
  rectifySchema,
  falseConfirmationSchema,
  escalateSchema,
  proposeDeductionSchema,
]);

function categoryLabel(
  settings: Awaited<ReturnType<typeof getAppSettings>>,
  key: string
): string {
  const match = settings.accountability.issueCategories.find((c) => c.key === key);
  return match?.label ?? key;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // All three roles may reach the endpoint; per-action authority is enforced
    // below (QA_INSPECTOR may ONLY use "rectify").
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const isAdminOps =
      session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
    if (body.action !== "rectify" && !isAdminOps) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const issue = await db.qaIssue.findUnique({ where: { id: params.id } });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    }

    const settings = await getAppSettings();
    const label = categoryLabel(settings, issue.category);

    if (body.action === "rectify") {
      const resolvedRectifiedById =
        body.rectifiedById ??
        (body.status === RectificationStatus.FIXED_BY_QA
          ? session.user.id
          : issue.rectifiedById ?? null);

      const result = await db.$transaction(async (tx) => {
        let rectificationCost = issue.rectificationCost;
        let payAdjustmentId = issue.payAdjustmentId;
        let requiresManagerReview = false;
        let bandAmount = 0;

        if (body.status === RectificationStatus.FIXED_BY_QA && body.minutes != null) {
          const band = resolveRectificationBand(body.minutes, settings.accountability.rectification);
          requiresManagerReview = band.requiresManagerReview;
          bandAmount = band.amount;
          if (!band.requiresManagerReview && band.amount > 0) {
            const sourceKey = buildRectificationSourceKey(issue.id);
            const existing = await tx.cleanerPayAdjustment.findFirst({
              where: { source: "QA_RECTIFICATION_PAY", sourceKey },
              select: { id: true },
            });
            if (existing) {
              payAdjustmentId = existing.id;
            } else {
              const created = await tx.cleanerPayAdjustment.create({
                data: {
                  jobId: issue.jobId,
                  propertyId: issue.propertyId,
                  // PAY to the QA who fixed it (the rectifier), not the cleaner.
                  cleanerId: resolvedRectifiedById ?? session.user.id,
                  scope: PayAdjustmentScope.JOB,
                  title: `QA rectification — ${label}`,
                  type: PayAdjustmentType.FIXED,
                  requestedAmount: band.amount,
                  status: PayAdjustmentStatus.PENDING,
                  source: "QA_RECTIFICATION_PAY",
                  sourceKey,
                },
              });
              payAdjustmentId = created.id;
            }
            rectificationCost = band.amount;
          }
        }

        const updated = await tx.qaIssue.update({
          where: { id: issue.id },
          data: {
            rectificationStatus: body.status,
            rectifiedById: resolvedRectifiedById ?? undefined,
            ...(body.minutes != null ? { rectificationMinutes: body.minutes } : {}),
            ...(body.beforeKeys ? { rectificationBeforeKeys: body.beforeKeys as any } : {}),
            ...(body.afterKeys ? { rectificationAfterKeys: body.afterKeys as any } : {}),
            ...(rectificationCost != null ? { rectificationCost } : {}),
            ...(payAdjustmentId ? { payAdjustmentId } : {}),
          },
        });

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: issue.jobId,
            action: "QA_ISSUE_RECTIFY",
            entity: "QaIssue",
            entityId: issue.id,
            before: {
              rectificationStatus: issue.rectificationStatus,
              rectificationMinutes: issue.rectificationMinutes,
              rectificationCost: issue.rectificationCost,
              rectifiedById: issue.rectifiedById,
              payAdjustmentId: issue.payAdjustmentId,
            } as any,
            after: {
              rectificationStatus: updated.rectificationStatus,
              rectificationMinutes: updated.rectificationMinutes,
              rectificationCost: updated.rectificationCost,
              rectifiedById: updated.rectifiedById,
              payAdjustmentId: updated.payAdjustmentId,
              bandAmount,
              requiresManagerReview,
            } as any,
          },
        });

        return updated;
      });

      return NextResponse.json(result);
    }

    if (body.action === "falseConfirmation") {
      const decision =
        body.decision === "CONFIRMED"
          ? FalseConfirmationStatus.CONFIRMED
          : FalseConfirmationStatus.REJECTED;

      const result = await db.$transaction(async (tx) => {
        const updated = await tx.qaIssue.update({
          where: { id: issue.id },
          data: {
            falseConfirmation: decision,
            falseConfReviewedById: session.user.id,
            falseConfReviewedAt: new Date(),
          },
        });

        // On REJECTED, reverse the extra false-confirmation deduction that was
        // applied to the linked review at submit time (when SUSPECTED). CONFIRMED
        // keeps the deduction — nothing changes on the score.
        let reviewAfter: Record<string, unknown> | null = null;
        if (
          body.decision === "REJECTED" &&
          issue.qaReviewId
        ) {
          const review = await tx.qAReview.findUnique({
            where: { id: issue.qaReviewId },
            select: { id: true, jobId: true, score: true, rawScore: true },
          });
          if (review && review.rawScore != null) {
            const extra = settings.accountability.scoring.falseConfirmationExtraDeduction;
            const newScore = Math.min(100, roundCents(review.score + extra));
            // Any CRITICAL issue on this review keeps the management-review routing.
            const criticalCount = await tx.qaIssue.count({
              where: { qaReviewId: review.id, severity: "CRITICAL" },
            });
            const hasCritical =
              criticalCount > 0 && settings.accountability.scoring.criticalTriggersManagementReview;
            const rating = ratingForScore(newScore, settings.accountability.scoring, hasCritical);
            const passed = rating === "EXCELLENT" || rating === "PASS";
            await tx.qAReview.update({
              where: { id: review.id },
              data: {
                score: newScore,
                rating,
                passed,
                managementReview: hasCritical,
                adjustmentReason: "False confirmation rejected — deduction reversed",
                editedById: session.user.id,
                editedAt: new Date(),
              },
            });
            reviewAfter = { reviewId: review.id, score: newScore, rating, passed };
          }
        }

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: issue.jobId,
            action: "QA_ISSUE_FALSE_CONFIRMATION",
            entity: "QaIssue",
            entityId: issue.id,
            before: {
              falseConfirmation: issue.falseConfirmation,
            } as any,
            after: {
              falseConfirmation: updated.falseConfirmation,
              review: reviewAfter,
            } as any,
          },
        });

        return { updated, recompute: Boolean(reviewAfter) };
      });

      // Re-derive the job outcome after a score change (outside the txn so the
      // authority read sees the committed review).
      if (result.recompute) {
        await recomputeJobQaOutcome(issue.jobId);
      }

      return NextResponse.json(result.updated);
    }

    if (body.action === "escalate") {
      const result = await db.$transaction(async (tx) => {
        const updated = await tx.qaIssue.update({
          where: { id: issue.id },
          data: {
            rectificationStatus: RectificationStatus.ESCALATED,
            escalatedAt: new Date(),
          },
        });

        const coaching = await tx.coachingRecord.create({
          data: {
            cleanerId: issue.cleanerId,
            createdById: session.user.id,
            type: CoachingRecordType.MANAGEMENT_REVIEW,
            status: CoachingRecordStatus.OPEN,
            reason: body.reason,
            issueIds: [issue.id] as any,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: issue.jobId,
            action: "QA_ISSUE_ESCALATE",
            entity: "QaIssue",
            entityId: issue.id,
            before: { rectificationStatus: issue.rectificationStatus } as any,
            after: {
              rectificationStatus: updated.rectificationStatus,
              coachingRecordId: coaching.id,
            } as any,
          },
        });

        return updated;
      });

      return NextResponse.json(result);
    }

    // action === "proposeDeduction"
    const amount = roundCents(Math.abs(body.amount));
    const sourceKey = `${buildRectificationSourceKey(issue.id)}:ded`;
    const result = await db.$transaction(async (tx) => {
      let payAdjustmentId = issue.payAdjustmentId;
      const existing = await tx.cleanerPayAdjustment.findFirst({
        where: { source: "RECTIFICATION_DEDUCTION", sourceKey },
        select: { id: true },
      });
      let adjustmentId: string;
      if (existing) {
        adjustmentId = existing.id;
      } else {
        const created = await tx.cleanerPayAdjustment.create({
          data: {
            jobId: issue.jobId,
            propertyId: issue.propertyId,
            cleanerId: issue.cleanerId,
            scope: PayAdjustmentScope.JOB,
            title: `Rectification deduction — ${label}`,
            type: PayAdjustmentType.FIXED,
            requestedAmount: -amount,
            status: PayAdjustmentStatus.PENDING,
            adminNote: body.note ?? null,
            source: "RECTIFICATION_DEDUCTION",
            sourceKey,
          },
        });
        adjustmentId = created.id;
      }
      // Link the issue to the proposal only if it isn't already pointing somewhere.
      if (!payAdjustmentId) payAdjustmentId = adjustmentId;

      const updated = await tx.qaIssue.update({
        where: { id: issue.id },
        data: { payAdjustmentId },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: issue.jobId,
          action: "QA_ISSUE_PROPOSE_DEDUCTION",
          entity: "QaIssue",
          entityId: issue.id,
          before: { payAdjustmentId: issue.payAdjustmentId } as any,
          after: {
            payAdjustmentId: updated.payAdjustmentId,
            deductionAdjustmentId: adjustmentId,
            amount: -amount,
          } as any,
        },
      });

      return updated;
    });

    return NextResponse.json(result);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update issue." }, { status });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    const issue = await db.qaIssue.findUnique({
      where: { id: params.id },
      include: {
        job: { select: { id: true, jobNumber: true, scheduledDate: true } },
        property: { select: { id: true, name: true } },
        cleaner: { select: { id: true, name: true, email: true } },
        rectifiedBy: { select: { id: true, name: true } },
        qaReview: { select: { id: true, score: true, rawScore: true, rating: true, passed: true } },
      },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    }
    return NextResponse.json(issue);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load issue." }, { status });
  }
}
