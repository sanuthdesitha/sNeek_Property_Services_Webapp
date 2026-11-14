/**
 * D2 — the admin side of a damage report: costing it, and releasing it.
 *
 * RELEASE IS TWO WRITES, NOT ONE. Setting `DamageReport.clientVisible` alone
 * would not actually show the client anything useful, and clearing it alone
 * would not hide anything: the client also reads damage as CASES, through the
 * cases workspace. D1 deliberately creates those cases hidden, so release has
 * to lift the report and its cases together. Doing it in one transaction is the
 * point — a half-applied release either leaks damage the admin has not
 * approved, or shows a report whose cases are still invisible.
 *
 * COST IS ADMIN-ONLY, AND THAT IS ENFORCED IN THREE PLACES. Nothing in the
 * cleaner schemas accepts `estimatedCost` (lib/damage/validation.ts), the
 * client view model nulls it (lib/damage/investigation.ts), and it is written
 * only here, from a route that requires an admin role. Any one of those alone
 * would be a single point of failure.
 */

import { DamageReportStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Set (or clear) the admin's cost estimate for one damaged item.
 *
 * Rejects negatives and non-finite numbers rather than storing them: a negative
 * repair cost is meaningless and would corrupt any total built on top of it.
 * Pass null to clear.
 */
export async function setDamageItemCost(input: {
  itemId: string;
  estimatedCost: number | null;
  /** When given, the item must belong to this report (entity scope), and the change is kept in its history. */
  reportId?: string;
  actorUserId?: string;
}) {
  if (input.estimatedCost !== null) {
    if (!Number.isFinite(input.estimatedCost) || input.estimatedCost < 0) {
      throw new Error("DAMAGE_COST_INVALID");
    }
  }

  const item = await db.damageItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, reportId: true, estimatedCost: true, category: true, area: true },
  });
  if (!item) throw new Error("DAMAGE_ITEM_NOT_FOUND");
  // An item id from another report is answered as not found, never written.
  if (input.reportId && item.reportId !== input.reportId) throw new Error("DAMAGE_ITEM_NOT_FOUND");

  const updated = await db.damageItem.update({
    where: { id: input.itemId },
    data: { estimatedCost: input.estimatedCost },
    select: { id: true, estimatedCost: true },
  });
  if (input.actorUserId && (item.estimatedCost ?? null) !== (input.estimatedCost ?? null)) {
    await recordReviewAudit({
      actorUserId: input.actorUserId,
      reportId: item.reportId,
      action: "DAMAGE_ITEM_ESTIMATE_SET",
      before: { itemId: item.id, estimatedCost: item.estimatedCost ?? null },
      after: { itemId: item.id, estimatedCost: input.estimatedCost, item: `${item.category} · ${item.area}` },
    });
  }
  return updated;
}

/** One history entry on the report (best effort; the change itself is already stored). */
async function recordReviewAudit(input: { actorUserId: string; reportId: string; action: string; before?: Prisma.InputJsonObject; after: Prisma.InputJsonObject }) {
  try {
    await db.auditLog.create({
      data: { userId: input.actorUserId, action: input.action, entity: "DamageReport", entityId: input.reportId, before: input.before, after: input.after },
    });
  } catch (error) {
    logger.error({ err: error, damageReportId: input.reportId, action: input.action }, "Damage report changed, but its history entry could not be written");
  }
}

/** Which history entry a review writes, from the report before and the decision. */
export function reviewAuditAction(before: { clientVisible: boolean; status: DamageReportStatus }, input: { release: boolean; close?: boolean }): string {
  if (input.close) return input.release ? "DAMAGE_REPORT_CLOSED_RELEASED" : "DAMAGE_REPORT_CLOSED";
  if (input.release && !before.clientVisible) return "DAMAGE_REPORT_RELEASED";
  if (!input.release && before.clientVisible) return "DAMAGE_REPORT_TAKEN_BACK";
  if (before.status === DamageReportStatus.CLOSED) return "DAMAGE_REPORT_REOPENED";
  return "DAMAGE_REPORT_REVIEWED";
}

/**
 * Record an admin review, and optionally release the report to the client.
 *
 * `release: true` is the only thing that ever makes damage client-visible.
 * `release: false` retracts it — an admin who released something by mistake can
 * take it back, and the cases go with it.
 *
 * Refuses to act on a DRAFT: a report the cleaner has not submitted is working
 * notes, and releasing one would show the client a half-documented finding.
 */
export async function reviewDamageReport(input: {
  reportId: string;
  reviewerUserId: string;
  release: boolean;
  close?: boolean;
}) {
  const report = await db.damageReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, status: true, clientVisible: true, items: { select: { caseId: true } } },
  });
  if (!report) throw new Error("DAMAGE_REPORT_NOT_FOUND");
  if (report.status === DamageReportStatus.DRAFT) throw new Error("DAMAGE_REPORT_NOT_SUBMITTED");

  const caseIds = report.items
    .map((item) => item.caseId)
    .filter((caseId): caseId is string => Boolean(caseId));

  const nextStatus = input.close ? DamageReportStatus.CLOSED : DamageReportStatus.UNDER_REVIEW;

  return db.$transaction(async (tx) => {
    const updated = await tx.damageReport.update({
      where: { id: input.reportId },
      data: {
        status: nextStatus,
        clientVisible: input.release,
        reviewedById: input.reviewerUserId,
        reviewedAt: new Date(),
      },
      select: { id: true, status: true, clientVisible: true, reviewedAt: true },
    });

    // The cases move with the report. Without this the client either sees
    // damage through the cases workspace that the report still hides, or reads
    // a released report whose cases remain invisible.
    if (caseIds.length > 0) {
      await tx.issueTicket.updateMany({
        where: { id: { in: caseIds } },
        data: { clientVisible: input.release, clientCanReply: input.release },
      });
    }

    // The decision's history entry commits with the decision itself.
    await tx.auditLog.create({
      data: {
        userId: input.reviewerUserId,
        action: reviewAuditAction(report, input),
        entity: "DamageReport",
        entityId: input.reportId,
        before: { status: report.status, clientVisible: report.clientVisible },
        after: { status: nextStatus, clientVisible: input.release, caseCount: caseIds.length },
      },
    });

    return { ...updated, wasClientVisible: report.clientVisible };
  });
}
