/**
 * Record how a QA issue was rectified. Moved unchanged out of
 * PATCH /api/admin/qa/issues/[id] so the single action and the Quality hub's
 * bulk "Mark fixed" run the same transaction: the same payee rule, the same
 * rectification band and idempotent QA rectification pay (always a PENDING
 * adjustment), and the same audit row.
 */
import {
  PayAdjustmentScope,
  PayAdjustmentStatus,
  PayAdjustmentType,
  RectificationStatus,
  type Prisma,
  type QaIssue,
  type Role,
} from "@prisma/client";
import { db } from "@/lib/db";
import type { getAppSettings } from "@/lib/settings";
import {
  buildRectificationSourceKey,
  resolveRectificationBand,
  resolveRectificationPayee,
} from "@/lib/accountability/rectification";

type AppSettings = Awaited<ReturnType<typeof getAppSettings>>;

export type RectifyInput = {
  status: RectificationStatus;
  minutes?: number;
  beforeKeys?: string[];
  afterKeys?: string[];
  rectifiedById?: string;
};

export type RectifyActor = { id: string; role: Role | string };

export function issueCategoryLabel(settings: AppSettings, key: string): string {
  const match = settings.accountability.issueCategories.find((c) => c.key === key);
  return match?.label ?? key;
}

export async function rectifyQaIssue(params: {
  issue: QaIssue;
  input: RectifyInput;
  actor: RectifyActor;
  settings: AppSettings;
}): Promise<QaIssue> {
  const { issue, input, actor, settings } = params;
  const label = issueCategoryLabel(settings, issue.category);

  // WHO gets the rectification pay. See resolveRectificationPayee — an
  // ADMIN/OPS recording the fix on the inspector's behalf must NOT be
  // credited; the money follows the QA who actually did the work.
  const payee = resolveRectificationPayee({
    explicitRectifiedById: input.rectifiedById ?? null,
    issueRectifiedById: issue.rectifiedById,
    issueRaisedById: issue.raisedById,
    sessionUserId: actor.id,
    sessionRole: actor.role as Role,
  });
  const resolvedRectifiedById = payee.payeeUserId;

  return db.$transaction(async (tx) => {
    let rectificationCost = issue.rectificationCost;
    let payAdjustmentId = issue.payAdjustmentId;
    let requiresManagerReview = false;
    let bandAmount = 0;

    if (input.status === RectificationStatus.FIXED_BY_QA && input.minutes != null) {
      const band = resolveRectificationBand(input.minutes, settings.accountability.rectification);
      requiresManagerReview = band.requiresManagerReview;
      bandAmount = band.amount;
      // No resolvable QA payee ⇒ create NO money. Paying the wrong person
      // is worse than not paying yet; the admin can re-save with an
      // explicit rectifiedById.
      if (!band.requiresManagerReview && band.amount > 0 && resolvedRectifiedById) {
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
              // PAY to the QA who fixed it (the rectifier), not the cleaner
              // and NOT the admin who happens to be recording it.
              cleanerId: resolvedRectifiedById,
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
        rectificationStatus: input.status,
        rectifiedById: resolvedRectifiedById ?? undefined,
        ...(input.minutes != null ? { rectificationMinutes: input.minutes } : {}),
        ...(input.beforeKeys ? { rectificationBeforeKeys: input.beforeKeys as Prisma.InputJsonValue } : {}),
        ...(input.afterKeys ? { rectificationAfterKeys: input.afterKeys as Prisma.InputJsonValue } : {}),
        ...(rectificationCost != null ? { rectificationCost } : {}),
        ...(payAdjustmentId ? { payAdjustmentId } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.id,
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
        },
        after: {
          rectificationStatus: updated.rectificationStatus,
          rectificationMinutes: updated.rectificationMinutes,
          rectificationCost: updated.rectificationCost,
          rectifiedById: updated.rectifiedById,
          payAdjustmentId: updated.payAdjustmentId,
          bandAmount,
          requiresManagerReview,
          // Provenance for the money: who was credited and by which rule.
          rectificationPayeeId: resolvedRectifiedById,
          rectificationPayeeSource: payee.source,
        },
      },
    });

    return updated;
  });
}
