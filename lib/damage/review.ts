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

import { DamageReportStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Set (or clear) the admin's cost estimate for one damaged item.
 *
 * Rejects negatives and non-finite numbers rather than storing them: a negative
 * repair cost is meaningless and would corrupt any total built on top of it.
 * Pass null to clear.
 */
export async function setDamageItemCost(input: { itemId: string; estimatedCost: number | null }) {
  if (input.estimatedCost !== null) {
    if (!Number.isFinite(input.estimatedCost) || input.estimatedCost < 0) {
      throw new Error("DAMAGE_COST_INVALID");
    }
  }

  const item = await db.damageItem.findUnique({
    where: { id: input.itemId },
    select: { id: true },
  });
  if (!item) throw new Error("DAMAGE_ITEM_NOT_FOUND");

  return db.damageItem.update({
    where: { id: input.itemId },
    data: { estimatedCost: input.estimatedCost },
    select: { id: true, estimatedCost: true },
  });
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
    select: { id: true, status: true, items: { select: { caseId: true } } },
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

    return updated;
  });
}
