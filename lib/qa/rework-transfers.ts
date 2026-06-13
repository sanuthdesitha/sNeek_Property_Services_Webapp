/**
 * Cleaner ↔ QA rework transfer service.
 *
 * The QA inspector flags work the cleaner missed and (optionally) that QA had
 * to redo it. This files a `QaReworkTransfer` (PENDING) carrying severity,
 * reason, areas and the proposed minutes/pay to move from the cleaner to the
 * QA inspector.
 *
 * On ADMIN approval the transfer "cuts the cleaner's time and gives it to the
 * QA person" by reusing the existing pay/time-adjustment plumbing — it never
 * reinvents payroll maths, it just writes adjustment records the payroll engine
 * already consumes (`lib/finance/payroll.ts` sums approved CleanerPayAdjustment
 * amounts and uses TimeLog.durationM for paid hours):
 *
 *   1. Reduce the cleaner's most-recent stopped TimeLog for the job by
 *      `minutesFromCleaner` and write an already-APPROVED TimeLogAdjustmentRequest
 *      audit row.
 *   2. Create an APPROVED CleanerPayAdjustment for the CLEANER with a NEGATIVE
 *      approvedAmount (= -amountFromCleaner) — a deduction.
 *   3. Create an APPROVED CleanerPayAdjustment for the QA inspector with a
 *      POSITIVE approvedAmount (= +amountFromCleaner) — the credit.
 *
 * Confirmed reworks also feed the cleaner's quality stats
 * (`lib/workforce/performance.ts`) and are surfaced to the cleaner via a
 * notification + their job briefing.
 */
import {
  NotificationChannel,
  NotificationStatus,
  PayAdjustmentScope,
  PayAdjustmentType,
  PayAdjustmentStatus,
  QaReworkSeverity,
  QaReworkTransferStatus,
  Role,
  TimeAdjustmentStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";

export const QA_REWORK_INCLUDE = {
  job: {
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      startTime: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
  },
  cleaner: { select: { id: true, name: true, email: true, image: true, role: true } },
  qaUser: { select: { id: true, name: true, email: true, image: true, role: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
} as const;

export function severityLabel(severity: QaReworkSeverity) {
  switch (severity) {
    case "MAJOR":
      return "Major";
    case "MODERATE":
      return "Moderate";
    default:
      return "Minor";
  }
}

export async function createQaReworkTransfer(input: {
  jobId: string;
  assignmentId?: string | null;
  qaUserId: string;
  cleanerUserId: string;
  severity: QaReworkSeverity;
  reason: string;
  areas: string[];
  minutesFromCleaner: number;
  amountFromCleaner: number;
  affectsCleanerStats: boolean;
}) {
  const minutes = Math.max(0, Math.round(Number(input.minutesFromCleaner) || 0));
  const amount = Math.max(0, Number(input.amountFromCleaner) || 0);

  const transfer = await db.qaReworkTransfer.create({
    data: {
      jobId: input.jobId,
      assignmentId: input.assignmentId || undefined,
      qaUserId: input.qaUserId,
      cleanerUserId: input.cleanerUserId,
      severity: input.severity,
      reason: input.reason.trim().slice(0, 4000),
      areas: input.areas.length > 0 ? (input.areas as any) : undefined,
      minutesFromCleaner: minutes,
      amountFromCleaner: amount,
      affectsCleanerStats: input.affectsCleanerStats,
      status: QaReworkTransferStatus.PENDING,
    },
    include: QA_REWORK_INCLUDE,
  });

  await db.auditLog.create({
    data: {
      userId: input.qaUserId,
      jobId: input.jobId,
      action: "QA_REWORK_TRANSFER_CREATE",
      entity: "QaReworkTransfer",
      entityId: transfer.id,
      after: {
        severity: transfer.severity,
        minutesFromCleaner: minutes,
        amountFromCleaner: amount,
        cleanerUserId: input.cleanerUserId,
      } as any,
    },
  });

  // Notify admins/ops there is a rework transfer awaiting approval.
  await notifyAdminsByPush({
    jobId: input.jobId,
    subject: "QA rework transfer awaiting approval",
    body: `${transfer.job.property?.name ?? "A job"}: ${severityLabel(transfer.severity)} rework flagged by ${
      transfer.qaUser.name ?? "QA"
    } — ${minutes} min / $${amount.toFixed(2)} proposed to move from ${transfer.cleaner.name ?? "the cleaner"}.`,
  }).catch(() => undefined);

  return transfer;
}

export async function listQaReworkTransfers(status?: QaReworkTransferStatus) {
  return db.qaReworkTransfer.findMany({
    where: status ? { status } : undefined,
    include: QA_REWORK_INCLUDE,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

/**
 * Admin/ops decision on a pending transfer. On APPROVED we cut the cleaner's
 * time + pay and credit the QA inspector via existing adjustment records.
 */
export async function reviewQaReworkTransfer(params: {
  id: string;
  reviewerUserId: string;
  status: Extract<QaReworkTransferStatus, "APPROVED" | "REJECTED">;
  adminNote?: string | null;
}) {
  const existing = await db.qaReworkTransfer.findUnique({
    where: { id: params.id },
    include: QA_REWORK_INCLUDE,
  });
  if (!existing) throw new Error("Rework transfer not found.");
  if (existing.status !== QaReworkTransferStatus.PENDING) {
    throw new Error("This rework transfer has already been reviewed.");
  }

  const minutes = Math.max(0, Math.round(existing.minutesFromCleaner));
  const amount = Math.max(0, Number(existing.amountFromCleaner));
  const propertyName = existing.job.property?.name ?? "the property";
  const adminNote = params.adminNote?.trim() || null;

  await db.$transaction(async (tx) => {
    if (params.status === QaReworkTransferStatus.APPROVED) {
      // 1. Cut the cleaner's logged time on this job by `minutes`.
      if (minutes > 0) {
        const lastLog = await tx.timeLog.findFirst({
          where: { jobId: existing.jobId, userId: existing.cleanerUserId, stoppedAt: { not: null } },
          orderBy: { startedAt: "desc" },
        });
        if (lastLog) {
          const originalDurationM = Math.max(0, Number(lastLog.durationM ?? 0));
          const newDurationM = Math.max(0, originalDurationM - minutes);
          const newStoppedAt = new Date(lastLog.startedAt.getTime() + newDurationM * 60_000);
          await tx.timeLog.update({
            where: { id: lastLog.id },
            data: { durationM: newDurationM, stoppedAt: newStoppedAt },
          });
          // Audit the time cut as an already-approved adjustment request so it
          // shows up in the cleaner's clock-adjustment history.
          await tx.timeLogAdjustmentRequest.create({
            data: {
              timeLogId: lastLog.id,
              jobId: existing.jobId,
              cleanerId: existing.cleanerUserId,
              requestedDurationM: newDurationM,
              requestedStoppedAt: newStoppedAt,
              originalDurationM,
              originalStoppedAt: lastLog.stoppedAt,
              reason: `QA rework transfer: ${minutes} min moved to QA inspector. ${existing.reason}`.slice(0, 4000),
              status: TimeAdjustmentStatus.APPROVED,
              reviewedById: params.reviewerUserId,
              reviewedAt: new Date(),
              adminNote,
            },
          });
        }
      }

      // 2. Deduct pay from the cleaner (negative approved amount).
      if (amount > 0) {
        await tx.cleanerPayAdjustment.create({
          data: {
            jobId: existing.jobId,
            propertyId: existing.job.property?.id ?? undefined,
            cleanerId: existing.cleanerUserId,
            scope: PayAdjustmentScope.JOB,
            title: `QA rework deduction — ${propertyName}`,
            type: PayAdjustmentType.FIXED,
            requestedAmount: -amount,
            approvedAmount: -amount,
            status: PayAdjustmentStatus.APPROVED,
            cleanerNote: `Work redone by QA (${severityLabel(existing.severity)}). ${existing.reason}`.slice(0, 4000),
            adminNote,
            reviewedById: params.reviewerUserId,
            reviewedAt: new Date(),
          },
        });

        // 3. Credit the QA inspector (positive approved amount).
        await tx.cleanerPayAdjustment.create({
          data: {
            jobId: existing.jobId,
            propertyId: existing.job.property?.id ?? undefined,
            cleanerId: existing.qaUserId,
            scope: PayAdjustmentScope.JOB,
            title: `QA rework credit — ${propertyName}`,
            type: PayAdjustmentType.FIXED,
            requestedAmount: amount,
            approvedAmount: amount,
            status: PayAdjustmentStatus.APPROVED,
            cleanerNote: `Credit for redoing missed work (${severityLabel(existing.severity)}).`,
            adminNote,
            reviewedById: params.reviewerUserId,
            reviewedAt: new Date(),
          },
        });
      }
    }

    await tx.qaReworkTransfer.update({
      where: { id: existing.id },
      data: {
        status: params.status,
        reviewedById: params.reviewerUserId,
        reviewedAt: new Date(),
        adminNote,
      },
    });

    // Tell the cleaner — including the shared rework note so they can self-correct.
    await tx.notification.create({
      data: {
        userId: existing.cleanerUserId,
        jobId: existing.jobId,
        channel: NotificationChannel.PUSH,
        subject:
          params.status === QaReworkTransferStatus.APPROVED
            ? "QA rework recorded on your job"
            : "QA rework transfer declined",
        body:
          params.status === QaReworkTransferStatus.APPROVED
            ? `${propertyName}: QA flagged ${severityLabel(existing.severity)} rework. ${
                minutes > 0 ? `${minutes} min` : ""
              }${minutes > 0 && amount > 0 ? " and " : ""}${
                amount > 0 ? `$${amount.toFixed(2)}` : ""
              } moved to the QA inspector. Note: ${existing.reason}`.slice(0, 480)
            : `${propertyName}: A QA rework transfer against your job was declined by admin.`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: params.reviewerUserId,
        jobId: existing.jobId,
        action: "QA_REWORK_TRANSFER_REVIEW",
        entity: "QaReworkTransfer",
        entityId: existing.id,
        after: { status: params.status, minutes, amount, adminNote } as any,
      },
    });
  });

  return db.qaReworkTransfer.findUnique({ where: { id: existing.id }, include: QA_REWORK_INCLUDE });
}

/**
 * Aggregate confirmed (APPROVED) rework for a cleaner in a window.
 * Used by the performance metrics to expose a "rework / miss rate".
 */
export async function getCleanerReworkStats(cleanerUserId: string, windowStart: Date) {
  const rows = await db.qaReworkTransfer.findMany({
    where: {
      cleanerUserId,
      affectsCleanerStats: true,
      status: QaReworkTransferStatus.APPROVED,
      reviewedAt: { gte: windowStart },
    },
    select: { id: true, severity: true, minutesFromCleaner: true, amountFromCleaner: true },
  });
  return {
    count: rows.length,
    minutes: rows.reduce((sum, r) => sum + Math.max(0, r.minutesFromCleaner), 0),
    amount: rows.reduce((sum, r) => sum + Math.max(0, Number(r.amountFromCleaner)), 0),
    major: rows.filter((r) => r.severity === QaReworkSeverity.MAJOR).length,
  };
}

/** Confirmed reworks visible to a cleaner for a given job (for the briefing). */
export async function listConfirmedReworkForCleanerJob(jobId: string, cleanerUserId: string) {
  return db.qaReworkTransfer.findMany({
    where: {
      jobId,
      cleanerUserId,
      status: QaReworkTransferStatus.APPROVED,
    },
    select: {
      id: true,
      severity: true,
      reason: true,
      areas: true,
      minutesFromCleaner: true,
      amountFromCleaner: true,
      reviewedAt: true,
      qaUser: { select: { name: true } },
    },
    orderBy: { reviewedAt: "desc" },
    take: 5,
  });
}
