/**
 * D4 — voiding a damage submission.
 *
 * A damage report is evidence about somebody's property, so it is NEVER
 * hard-deleted. Voiding undoes the submission and hands the work back to the
 * cleaner, leaving a complete audit trail behind: who, when, why, and in which
 * mode. Every void appends a `DamageReportVoid` row — a list, not a field,
 * because a report can be voided, redone and voided again.
 *
 * Two modes, chosen at void time because the right answer depends on why:
 *
 *   KEEP_AND_REOPEN — the report was incomplete or slightly wrong. Items and
 *     photos stay exactly as they are, the submission is undone, and the
 *     cleaner edits what is already there. Case links are preserved, so
 *     resubmitting does NOT open a second case per damage (see the caseId
 *     carry-over in lib/damage/service.ts#saveDamageDraft).
 *
 *   CLEAR_AND_REDO — the report is unusable (wrong property, unreadable
 *     photos). The items are ARCHIVED into the void record as JSON and then
 *     cleared, so the cleaner starts from a blank form. Nothing is destroyed:
 *     the snapshot is the record of what they originally filed, and the S3
 *     objects behind the photos are untouched.
 *
 * Whatever the mode, three things are true afterwards:
 *   - the client cannot see it (report and its cases are un-released together,
 *     for the same reason release lifts them together);
 *   - every linked case carries an internal comment recording the void and its
 *     reason, which is how anything built on the report is flagged stale;
 *   - the cleaner is told, with the reason. Voiding someone's documented work
 *     without saying why is how the same mistake gets made twice.
 */

import {
  DamageReportStatus,
  DamageVoidMode,
  NotificationChannel,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface VoidDamageReportInput {
  reportId: string;
  actorUserId: string;
  mode: DamageVoidMode;
  /** Shown to the cleaner. The caller's schema requires it to be non-empty. */
  reason: string;
}

export async function voidDamageReport(input: VoidDamageReportInput) {
  const report = await db.damageReport.findUnique({
    where: { id: input.reportId },
    select: {
      id: true,
      jobId: true,
      status: true,
      reportedById: true,
      items: {
        select: {
          id: true,
          caseId: true,
          area: true,
          category: true,
          severity: true,
          description: true,
          suspectedCause: true,
          estimatedCost: true,
          photos: {
            select: {
              s3Key: true,
              annotatedKey: true,
              flatKey: true,
              caption: true,
              section: true,
            },
          },
        },
      },
    },
  });
  if (!report) throw new Error("DAMAGE_REPORT_NOT_FOUND");

  // A draft was never submitted, so there is no submission to undo. Voiding one
  // would only destroy a cleaner's in-progress work.
  if (report.status === DamageReportStatus.DRAFT) {
    throw new Error("DAMAGE_REPORT_NOT_SUBMITTED");
  }

  const caseIds = report.items
    .map((item) => item.caseId)
    .filter((caseId): caseId is string => Boolean(caseId));

  const clearing = input.mode === DamageVoidMode.CLEAR_AND_REDO;

  const result = await db.$transaction(async (tx) => {
    const voidRecord = await tx.damageReportVoid.create({
      data: {
        reportId: report.id,
        mode: input.mode,
        reason: input.reason,
        voidedById: input.actorUserId,
        // The snapshot is only meaningful when the items are about to go.
        archivedItems: clearing ? (report.items as unknown as object) : undefined,
        archivedCaseIds: caseIds.length > 0 ? (caseIds as unknown as object) : undefined,
      },
      select: { id: true, mode: true, voidedAt: true },
    });

    if (clearing) {
      // Photos cascade with their items. The evidence survives in
      // archivedItems, and the underlying S3 objects are untouched.
      await tx.damageItem.deleteMany({ where: { reportId: report.id } });
    }

    await tx.damageReport.update({
      where: { id: report.id },
      data: {
        status: DamageReportStatus.DRAFT,
        submittedAt: null,
        clientVisible: false,
        reviewedById: null,
        reviewedAt: null,
        // A sign-off belongs to the report the client actually read. Once it is
        // voided and redone, the old acknowledgement no longer means anything.
        acknowledgedAt: null,
        acknowledgedById: null,
        acknowledgedName: null,
      },
    });

    if (caseIds.length > 0) {
      await tx.issueTicket.updateMany({
        where: { id: { in: caseIds } },
        data: { clientVisible: false, clientCanReply: false },
      });

      // The stale flag. An internal comment rather than a status change: the
      // repair may genuinely still be needed, and closing the case would tell
      // CP-7 to resolve a maintenance item nobody has actually fixed.
      await tx.caseComment.createMany({
        data: caseIds.map((caseId) => ({
          caseId,
          authorUserId: input.actorUserId,
          isInternal: true,
          body:
            `Damage report voided (${clearing ? "cleared for redo" : "reopened for edit"}). ` +
            `Reason: ${input.reason}. Treat any report or QA built on this as stale ` +
            `until it is resubmitted.`,
        })),
      });
    }

    return voidRecord;
  });

  // Post-commit and guarded: the void is already recorded, and a failed
  // notification must not roll it back or surface as a failed void.
  try {
    await db.notification.create({
      data: {
        userId: report.reportedById,
        jobId: report.jobId,
        channel: NotificationChannel.PUSH,
        subject: "A damage report was sent back to you",
        body: clearing
          ? `Your damage report needs to be filed again. Reason: ${input.reason}`
          : `Your damage report was reopened so you can correct it. Reason: ${input.reason}`,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, damageReportId: report.id },
      "Damage void recorded, but notifying the cleaner failed"
    );
  }

  return result;
}
