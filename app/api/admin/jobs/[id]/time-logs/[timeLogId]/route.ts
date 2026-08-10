import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const MAX_SEGMENT_MINUTES = 24 * 60;

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date");

const patchSchema = z
  .object({
    startedAt: isoDate.optional(),
    // Explicit null reopens the segment (marks the cleaner as not clocked out).
    stoppedAt: isoDate.nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine(
    (body) => body.startedAt !== undefined || body.stoppedAt !== undefined || body.notes !== undefined,
    "Nothing to update"
  );

/**
 * Admin direct edit of a clock segment. Recomputes durationM (which drives
 * cleaner pay) from the edited timestamps, writes a before/after AuditLog and
 * notifies the cleaner. Distinct from the cleaner-initiated
 * TimeLogAdjustmentRequest approval flow, which stays untouched.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; timeLogId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const log = await db.timeLog.findUnique({
      where: { id: params.timeLogId },
      include: { user: { select: { id: true, name: true } }, job: { select: { id: true, jobNumber: true } } },
    });
    if (!log || log.jobId !== params.id) {
      return NextResponse.json({ error: "Time log not found for this job" }, { status: 404 });
    }

    const startedAt = body.startedAt !== undefined ? new Date(body.startedAt) : log.startedAt;
    const stoppedAt =
      body.stoppedAt === undefined
        ? log.stoppedAt
        : body.stoppedAt === null
          ? null
          : new Date(body.stoppedAt);

    if (stoppedAt) {
      const minutes = Math.round((stoppedAt.getTime() - startedAt.getTime()) / 60_000);
      if (minutes < 1) {
        return NextResponse.json(
          { error: "Clock-out must be after clock-in (at least 1 minute)." },
          { status: 400 }
        );
      }
      if (minutes > MAX_SEGMENT_MINUTES) {
        return NextResponse.json(
          { error: "A single clock segment cannot exceed 24 hours." },
          { status: 400 }
        );
      }
    } else if (log.stoppedAt) {
      // Reopening: the raw partial unique index TimeLog_job_user_open_unique
      // allows only one open segment per (job, cleaner) — check before writing.
      const otherOpen = await db.timeLog.findFirst({
        where: { jobId: log.jobId, userId: log.userId, stoppedAt: null, id: { not: log.id } },
        select: { id: true },
      });
      if (otherOpen) {
        return NextResponse.json(
          { error: "This cleaner already has another open clock segment on this job." },
          { status: 409 }
        );
      }
    }

    const durationM = stoppedAt
      ? Math.round((stoppedAt.getTime() - startedAt.getTime()) / 60_000)
      : null;

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.timeLog.update({
        where: { id: log.id },
        data: {
          startedAt,
          stoppedAt,
          durationM,
          ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: log.jobId,
          action: "ADMIN_EDIT_TIME_LOG",
          entity: "TimeLog",
          entityId: log.id,
          before: {
            startedAt: log.startedAt.toISOString(),
            stoppedAt: log.stoppedAt?.toISOString() ?? null,
            durationM: log.durationM,
            notes: log.notes,
          } as any,
          after: {
            startedAt: startedAt.toISOString(),
            stoppedAt: stoppedAt?.toISOString() ?? null,
            durationM,
            notes: body.notes !== undefined ? body.notes || null : log.notes,
          } as any,
        },
      });

      await tx.notification.create({
        data: {
          userId: log.userId,
          jobId: log.jobId,
          channel: NotificationChannel.PUSH,
          subject: "Clock times updated by admin",
          body: `${log.job.jobNumber}: An admin amended your recorded clock times${
            durationM != null ? ` (new segment total: ${durationM} minutes)` : ""
          }.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      return row;
    });

    // The stored report may now show stale clock times — refresh it in the
    // background if one has already been generated for this job.
    void refreshReportIfExists(log.jobId);

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

async function refreshReportIfExists(jobId: string): Promise<void> {
  try {
    const report = await db.report.findUnique({ where: { jobId }, select: { id: true } });
    if (!report) return;
    const { generateJobReport } = await import("@/lib/reports/generator");
    await generateJobReport(jobId);
  } catch (err) {
    logger.error({ err, jobId }, "Report refresh after time-log edit failed");
  }
}
