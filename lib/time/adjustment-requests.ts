import { NotificationChannel, NotificationStatus, TimeAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

export type TimeAdjustmentRequestRow = {
  id: string;
  status: TimeAdjustmentStatus;
  requestedDurationM: number;
  requestedStoppedAt: Date | null;
  originalDurationM: number;
  originalStoppedAt: Date | null;
  reason: string | null;
  adminNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  minimumApprovableDurationM: number;
  originalTotalDurationM: number;
  requestedTotalDurationM: number;
  cleaner: { id: string; name: string | null; email: string };
  reviewedBy: { id: string; name: string | null; email: string } | null;
  job: {
    id: string;
    jobNumber: string;
    jobType: string;
    scheduledDate: Date;
    property: { id: string; name: string; suburb: string };
  };
  timeLog: {
    id: string;
    startedAt: Date;
    stoppedAt: Date | null;
    durationM: number | null;
  };
};

async function getCompletedDurationBeforeCurrentLog(params: {
  jobId: string;
  cleanerId: string;
  timeLogId: string;
}) {
  const priorTime = await db.timeLog.aggregate({
    where: {
      jobId: params.jobId,
      userId: params.cleanerId,
      id: { not: params.timeLogId },
      stoppedAt: { not: null },
    },
    _sum: { durationM: true },
  });
  return Math.max(0, priorTime._sum.durationM ?? 0);
}

export async function listTimeAdjustmentRequests(status?: TimeAdjustmentStatus) {
  const rows = await db.timeLogAdjustmentRequest.findMany({
    where: status ? { status } : undefined,
    include: {
      cleaner: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
      timeLog: { select: { id: true, startedAt: true, stoppedAt: true, durationM: true } },
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          scheduledDate: true,
          property: { select: { id: true, name: true, suburb: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const hydrated: TimeAdjustmentRequestRow[] = [];
  for (const row of rows) {
    const completedDurationBeforeCurrentLog = await getCompletedDurationBeforeCurrentLog({
      jobId: row.jobId,
      cleanerId: row.cleanerId,
      timeLogId: row.timeLogId,
    });
    hydrated.push({
      ...row,
      minimumApprovableDurationM: completedDurationBeforeCurrentLog + 1,
      originalTotalDurationM: completedDurationBeforeCurrentLog + row.originalDurationM,
      requestedTotalDurationM: row.requestedDurationM,
    });
  }

  return hydrated;
}

export async function reviewTimeAdjustmentRequest(params: {
  id: string;
  reviewerUserId: string;
  status: Extract<TimeAdjustmentStatus, "APPROVED" | "REJECTED">;
  adminNote?: string | null;
  approvedDurationM?: number | null;
}) {
  const existing = await db.timeLogAdjustmentRequest.findUnique({
    where: { id: params.id },
    include: {
      cleaner: { select: { id: true, name: true, email: true } },
      timeLog: { select: { id: true, startedAt: true, stoppedAt: true, durationM: true } },
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          property: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!existing) {
    throw new Error("Time adjustment request not found.");
  }
  if (existing.status !== TimeAdjustmentStatus.PENDING) {
    throw new Error("This time adjustment request has already been reviewed.");
  }

  const completedDurationBeforeCurrentLog = await getCompletedDurationBeforeCurrentLog({
    jobId: existing.jobId,
    cleanerId: existing.cleanerId,
    timeLogId: existing.timeLogId,
  });

  const approvedTotalDurationM =
    params.status === TimeAdjustmentStatus.APPROVED
      ? Number(params.approvedDurationM ?? existing.requestedDurationM)
      : null;
  const approvedTotalDurationNumber = approvedTotalDurationM ?? Number.NaN;

  if (
    params.status === TimeAdjustmentStatus.APPROVED &&
    (!Number.isFinite(approvedTotalDurationNumber) ||
      approvedTotalDurationNumber <= completedDurationBeforeCurrentLog)
  ) {
    throw new Error(
      "Approved time must be greater than the time already logged before the final clock segment."
    );
  }

  const updated = await db.$transaction(async (tx) => {
    if (params.status === TimeAdjustmentStatus.APPROVED) {
      const approvedTotalMinutes = Number(approvedTotalDurationM ?? existing.requestedDurationM);
      const approvedCurrentSegmentMinutes = Math.max(
        0,
        approvedTotalMinutes - completedDurationBeforeCurrentLog
      );
      const approvedStoppedAt = new Date(
        existing.timeLog.startedAt.getTime() + approvedCurrentSegmentMinutes * 60_000
      );

      await tx.timeLog.update({
        where: { id: existing.timeLogId },
        data: {
          durationM: approvedCurrentSegmentMinutes,
          stoppedAt: approvedStoppedAt,
        },
      });
    }

    const reviewed = await tx.timeLogAdjustmentRequest.update({
      where: { id: existing.id },
      data: {
        status: params.status,
        adminNote: params.adminNote?.trim() || null,
        reviewedById: params.reviewerUserId,
        reviewedAt: new Date(),
      },
    });

    await tx.notification.create({
      data: {
        userId: existing.cleanerId,
        jobId: existing.jobId,
        channel: NotificationChannel.PUSH,
        subject:
          params.status === TimeAdjustmentStatus.APPROVED
            ? "Clock adjustment approved"
            : "Clock adjustment rejected",
        body:
          params.status === TimeAdjustmentStatus.APPROVED
            ? `${existing.job.jobNumber}: Admin approved your requested final time for ${existing.job.property.name}.`
            : `${existing.job.jobNumber}: Admin rejected your requested clock change for ${existing.job.property.name}.`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: params.reviewerUserId,
        jobId: existing.jobId,
        action: "REVIEW_TIME_ADJUSTMENT",
        entity: "TimeLogAdjustmentRequest",
        entityId: existing.id,
        after: {
          status: params.status,
          approvedTotalDurationM: approvedTotalDurationM ?? null,
          adminNote: params.adminNote?.trim() || null,
        } as any,
      },
    });

    return reviewed;
  });

  const settings = await getAppSettings();
  if (existing.cleaner.email) {
    const approvedLabel =
      params.status === TimeAdjustmentStatus.APPROVED && approvedTotalDurationM != null
        ? `<p><strong>Approved total time:</strong> ${approvedTotalDurationM} minutes</p>`
        : "";
    const adminNoteLabel = params.adminNote?.trim()
      ? `<p><strong>Admin note:</strong> ${params.adminNote.trim().replace(/</g, "&lt;")}</p>`
      : "";
    await sendEmailDetailed({
      to: existing.cleaner.email,
      subject: `${settings.companyName} - Clock Adjustment ${params.status}`,
      html: `
        <p>Hello ${existing.cleaner.name ?? existing.cleaner.email},</p>
        <p>Your clock adjustment request for <strong>${existing.job.property.name}</strong> (${existing.job.jobNumber}) has been <strong>${params.status.toLowerCase()}</strong>.</p>
        ${approvedLabel}
        ${adminNoteLabel}
      `,
    }).catch(() => undefined);
  }

  return updated;
}
