import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  Role,
  JobStatus,
  NotificationChannel,
  NotificationStatus,
  JobAssignmentResponseStatus,
} from "@prisma/client";
import { z } from "zod";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getAppSettings } from "@/lib/settings";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";

const schema = z.object({
  verificationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confirmChecklist: z.boolean().optional(),
  confirmOnSite: z.boolean().optional(),
  allowFutureStart: z.boolean().optional(),
  // Job-start accountability gate (Phase 2b): the cleaner confirmed the property
  // code and the correct laundry bag before clocking in.
  propertyCodeConfirmed: z.boolean().optional(),
  laundryBagConfirmed: z.boolean().optional(),
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
    const assignment = await db.jobAssignment.findFirst({
      where: {
        jobId: params.id,
        userId: session.user.id,
        removedAt: null,
      },
      select: {
        id: true,
        responseStatus: true,
      },
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
        isRework: true,
        internalNotes: true,
        property: {
          select: {
            name: true,
            laundryEnabled: true,
            laundryBagLabel: true,
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

    if (job.status === JobStatus.WAITING_CONTINUATION_APPROVAL) {
      return NextResponse.json(
        { error: "A continuation request is pending admin decision for this job." },
        { status: 409 }
      );
    }

    const pendingContinuation = await listContinuationRequests({ jobId: params.id, status: "PENDING" });
    if (pendingContinuation.length > 0) {
      return NextResponse.json(
        { error: "A continuation request is pending admin decision for this job." },
        { status: 409 }
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

    // ── Job-start accountability gate (Phase 2b) ──────────────────────────────
    // Before the FIRST clock-in for this cleaner, require confirmation that they
    // verified the property code and (for laundry properties) the correct laundry
    // bag. Server-side is authoritative; the UI is convenience. Read the settings
    // flag defensively — it defaults ON unless explicitly disabled.
    const requireStartConfirmation =
      (settings as unknown as {
        accountability?: { requireJobStartConfirmation?: boolean };
      }).accountability?.requireJobStartConfirmation !== false;
    // Laundry-bag confirmation only matters on Airbnb turnovers at
    // laundry-enabled properties WITH a labelled bag, and never on reworks
    // (reworks reuse the original clean's linen). Property-code is always
    // required when the flag is on. The bag-label check MUST match the UI
    // (job-workspace.tsx / v1 page only render the bag checkbox when a label
    // exists) — otherwise the server demands a confirmation the cleaner has no
    // control to give and clock-in is impossible.
    const laundryConfirmRequired =
      job.jobType === "AIRBNB_TURNOVER" &&
      job.property?.laundryEnabled !== false &&
      job.isRework !== true &&
      Boolean(job.property?.laundryBagLabel?.trim());
    if (requireStartConfirmation && isFirstStartForCleaner) {
      const propertyCodeOk = body.propertyCodeConfirmed === true;
      const laundryBagOk = !laundryConfirmRequired || body.laundryBagConfirmed === true;
      if (!propertyCodeOk || !laundryBagOk) {
        return NextResponse.json(
          {
            code: "JOB_START_CONFIRMATION_REQUIRED",
            error:
              "Before you clock in, confirm the property code" +
              (laundryConfirmRequired ? " and the correct laundry bag" : "") +
              ".",
            requireLaundryBag: laundryConfirmRequired,
          },
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
              where: { userId: session.user.id, removedAt: null },
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
      try {
        await db.timeLog.create({
          data: { jobId: params.id, userId: session.user.id, startedAt: new Date() },
        });
      } catch (err: any) {
        // A concurrent "start" (double-tap / retry) may have created the open
        // log first — the partial unique index (TimeLog_job_user_open_unique)
        // rejects the duplicate with P2002. That's the desired outcome: one open
        // log exists, so treat this as already-running rather than erroring.
        if (err?.code !== "P2002") throw err;
      }
    }

    await db.$transaction(async (tx) => {
      if (assignment.responseStatus !== JobAssignmentResponseStatus.ACCEPTED) {
        await tx.jobAssignment.update({
          where: { id: assignment.id },
          data: {
            responseStatus: JobAssignmentResponseStatus.ACCEPTED,
            respondedAt: new Date(),
            responseNote: "Accepted on job start.",
          },
        });
      }

      await tx.job.update({
        where: { id: params.id },
        data: {
          status: JobStatus.IN_PROGRESS,
          // Clear the "in transit" en-route fields when work actually begins so
          // the client's live view and the stale-en-route sweep don't treat a
          // started job as still driving. arrivedAt is left intact as a record.
          enRouteStartedAt: null,
          enRouteEtaMinutes: null,
          enRouteEtaUpdatedAt: null,
        },
      });
    });

    // Persist the job-start confirmation into job meta + an audit row (only on the
    // first gated start for this cleaner, so a resume/re-clock-in doesn't overwrite
    // the original record).
    if (requireStartConfirmation && isFirstStartForCleaner) {
      const confirmedAt = new Date().toISOString();
      const meta = parseJobInternalNotes(job.internalNotes);
      const nextNotes = serializeJobInternalNotes({
        ...meta,
        internalNoteText: meta.internalNoteText,
        startConfirmation: {
          propertyCode: true,
          laundryBag: laundryConfirmRequired ? body.laundryBagConfirmed === true : false,
          at: confirmedAt,
          byUserId: session.user.id,
        },
      });
      await db.job.update({
        where: { id: params.id },
        data: { internalNotes: nextNotes ?? null },
      });
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: job.id,
          action: "JOB_START_CONFIRMATION",
          entity: "Job",
          entityId: job.id,
          after: {
            propertyCode: true,
            laundryBag: laundryConfirmRequired ? body.laundryBagConfirmed === true : false,
            laundryConfirmRequired,
            propertyCodeSurface: job.property?.name ?? null,
            laundryBagLabel: job.property?.laundryBagLabel ?? null,
            at: confirmedAt,
          } as any,
          ipAddress:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null,
        },
      });
    }

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

    // Notify client that cleaning has started (fire-and-forget)
    sendClientJobNotification({ jobId: params.id, type: "JOB_STARTED" });

    return NextResponse.json({ ok: true, alreadyRunning: Boolean(openLog) });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
