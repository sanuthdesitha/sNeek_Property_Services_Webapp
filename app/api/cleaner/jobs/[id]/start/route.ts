import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobStatus, NotificationChannel, NotificationStatus } from "@prisma/client";
import { z } from "zod";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getAppSettings } from "@/lib/settings";

const schema = z.object({
  verificationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confirmChecklist: z.boolean().optional(),
  confirmOnSite: z.boolean().optional(),
  allowFutureStart: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const settings = await getAppSettings();

    // Verify this cleaner is assigned
    const assignment = await db.jobAssignment.findUnique({
      where: { jobId_userId: { jobId: params.id, userId: session.user.id } },
    });
    if (!assignment)
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        jobType: true,
        property: {
          select: {
            name: true,
          },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const lockedStatuses: JobStatus[] = [
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
      JobStatus.INVOICED,
    ];
    if (lockedStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: "Job is already finished. Admin must move it back to ASSIGNED before restarting." },
        { status: 400 }
      );
    }

    const timezone = settings.timezone || "Australia/Sydney";
    let scheduledLocalDate = "";
    let todayLocalDate = "";
    try {
      scheduledLocalDate = format(toZonedTime(job.scheduledDate, timezone), "yyyy-MM-dd");
      todayLocalDate = format(toZonedTime(new Date(), timezone), "yyyy-MM-dd");
    } catch {
      scheduledLocalDate = format(toZonedTime(job.scheduledDate, "Australia/Sydney"), "yyyy-MM-dd");
      todayLocalDate = format(toZonedTime(new Date(), "Australia/Sydney"), "yyyy-MM-dd");
    }

    const isFutureDate = scheduledLocalDate > todayLocalDate;
    const hasPriorTimeLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id },
      select: { id: true },
    });
    const isFirstStartForCleaner = !hasPriorTimeLog;

    if (isFirstStartForCleaner && isFutureDate && !body.allowFutureStart) {
      return NextResponse.json(
        {
          code: "FUTURE_START_CONFIRMATION_REQUIRED",
          error: `This job is scheduled for ${scheduledLocalDate}. Starting it on ${todayLocalDate} can cause dispatch and reporting issues.`,
          scheduledDate: scheduledLocalDate,
          todayDate: todayLocalDate,
          timezone,
        },
        { status: 409 }
      );
    }

    if (isFirstStartForCleaner && settings.cleanerStartRequireDateMatch) {
      let expected: string;
      try {
        expected = format(toZonedTime(job.scheduledDate, timezone), "yyyy-MM-dd");
      } catch {
        expected = format(toZonedTime(job.scheduledDate, "Australia/Sydney"), "yyyy-MM-dd");
      }
      if (body.verificationDate !== expected) {
        return NextResponse.json(
          { error: `Start verification failed. Enter scheduled date ${expected}.` },
          { status: 400 }
        );
      }
    }

    if (isFirstStartForCleaner && settings.cleanerStartRequireChecklistConfirm) {
      if (!body.confirmChecklist || !body.confirmOnSite) {
        return NextResponse.json(
          { error: "Please complete start verification checks before starting the job." },
          { status: 400 }
        );
      }
    }

    const openOtherLogs = await db.timeLog.findMany({
      where: {
        userId: session.user.id,
        stoppedAt: null,
        jobId: { not: params.id },
      },
      include: {
        job: {
          select: {
            id: true,
            status: true,
            jobType: true,
            scheduledDate: true,
            startTime: true,
            property: { select: { name: true } },
            assignments: {
              where: { userId: session.user.id },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    const isBlockingOpenLog = (log: (typeof openOtherLogs)[number]) => {
      const hasAssignment = log.job.assignments.length > 0;
      const isActiveStatus =
        log.job.status === JobStatus.ASSIGNED || log.job.status === JobStatus.IN_PROGRESS;
      return hasAssignment && isActiveStatus;
    };

    const activeOtherLog = openOtherLogs.find(isBlockingOpenLog) ?? null;
    const staleLogs = openOtherLogs.filter((log) => !isBlockingOpenLog(log));
    if (staleLogs.length > 0) {
      const now = new Date();
      await db.$transaction(
        staleLogs.map((log) =>
          db.timeLog.update({
            where: { id: log.id },
            data: {
              stoppedAt: now,
              durationM: Math.max(0, Math.round((now.getTime() - log.startedAt.getTime()) / 60_000)),
              notes: "Auto-closed stale active log during job start.",
            },
          })
        )
      );
    }

    if (activeOtherLog?.job) {
      return NextResponse.json(
        {
          code: "ACTIVE_JOB_IN_PROGRESS",
          error: "You already have another active job. Pause or complete it before starting this one.",
          activeJob: {
            id: activeOtherLog.job.id,
            status: activeOtherLog.job.status,
            jobType: activeOtherLog.job.jobType,
            propertyName: activeOtherLog.job.property?.name ?? "Unknown property",
            scheduledDate: activeOtherLog.job.scheduledDate,
            startTime: activeOtherLog.job.startTime ?? null,
          },
        },
        { status: 409 }
      );
    }

    const openLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (!openLog) {
      await db.timeLog.create({
        data: { jobId: params.id, userId: session.user.id, startedAt: new Date() },
      });
    }

    await db.job.update({
      where: { id: params.id },
      data: { status: JobStatus.IN_PROGRESS },
    });

    if (isFutureDate && body.allowFutureStart) {
      const actorName = session.user.name ?? session.user.email ?? "Cleaner";
      const propertyName = job.property?.name ?? "Unknown property";
      const adminUsers = await db.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true },
      });
      if (adminUsers.length > 0) {
        await db.notification.createMany({
          data: adminUsers.map((admin) => ({
            userId: admin.id,
            jobId: job.id,
            channel: NotificationChannel.PUSH,
            subject: "Future job started early",
            body: `${actorName} started ${job.jobType.replace(/_/g, " ")} at ${propertyName} on ${todayLocalDate} (scheduled ${scheduledLocalDate}, ${timezone}).`,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
        });
      }

      await db.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: job.id,
          action: "CLEANER_FUTURE_START_CONFIRMED",
          entity: "Job",
          entityId: job.id,
          before: {
            status: job.status,
            scheduledDate: scheduledLocalDate,
          } as any,
          after: {
            status: JobStatus.IN_PROGRESS,
            startedOn: todayLocalDate,
            timezone,
            allowFutureStart: true,
          } as any,
          ipAddress:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null,
        },
      });
    }

    return NextResponse.json({ ok: true, alreadyRunning: Boolean(openLog) });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
