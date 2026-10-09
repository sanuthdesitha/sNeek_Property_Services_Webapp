import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { JobStatus, Role } from "@prisma/client";
import { getTransactionAppSettings } from "@/lib/settings";
import { ActionReceiptError, withCleanerAction } from "@/lib/cleaner/action-receipt";

/**
 * Clock out WITHOUT completing the job form — only for cleaners the admin has
 * allowlisted. Stops the running clock and parks the job as "form pending":
 * it is explicitly NOT completed (stays PAUSED) until the cleaner returns and
 * submits the form (which then flows SUBMITTED → QA as usual).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job." }, { status: 403 });
    }

    const job = await db.job.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const result = await withCleanerAction({ session, jobId: params.id, action: "clock-out-early", requestId: _req.headers.get("X-Cleaner-Action-Id"), draftIdentity: _req.headers.get("X-Cleaner-Draft-Identity"), body: {} }, async tx => {
    await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = 'app' FOR SHARE`;
    const settings = await getTransactionAppSettings(tx);
    if (!settings.clockOutWithoutFormAllowedCleanerIds.includes(session.user.id)) return { status: 403, body: { error: "You're not allowed to clock out before completing the form. Ask an admin to enable this for you." } };
    const current = await tx.job.findUnique({ where: { id: params.id }, select: { status: true, cleanSkipStatus: true, formPendingAfterClockOut: true } });
    if (!current || current.cleanSkipStatus === "SKIPPED" || !([JobStatus.IN_PROGRESS, JobStatus.PAUSED] as JobStatus[]).includes(current.status)) {
      return { status: 409, body: { error: "This job cannot be clocked out early in its current state." } };
    }
    const openLog = await tx.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
      orderBy: { startedAt: "desc" },
    });

    const now = new Date();
    let durationM: number | null = null;
    let clockOut: { timeLogId: string; stoppedAt: string } | null = null;
    if (openLog) {
      durationM = Math.max(0, Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000));
      const closed = await tx.timeLog.updateMany({ where: { id: openLog.id, stoppedAt: null }, data: { stoppedAt: now, durationM } });
      if (closed.count === 1) clockOut = { timeLogId: openLog.id, stoppedAt: now.toISOString() };
      else durationM = null;
    }

    if (!clockOut && current.formPendingAfterClockOut) return { status: 200, body: { ok: true, durationM, clockOut: null, alreadyStopped: true } };

    await tx.job.update({
      where: { id: params.id },
      // PAUSED + a "form pending" flag: clocked out, but NOT completed until the
      // form is submitted. The job won't be billed/QA'd until then.
      data: { status: JobStatus.PAUSED, formPendingAfterClockOut: true, ...(clockOut ? { clockedOutEarlyAt: now } : {}) },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: clockOut ? "CLOCK_OUT_EARLY" : "FORM_PENDING_AFTER_CLOCK_OUT",
        entity: "Job",
        entityId: params.id,
        after: { durationM, formPending: true } as any,
      },
    });

    return { status: 200, body: { ok: true, durationM, clockOut, alreadyStopped: !clockOut } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    const status = err instanceof ActionReceiptError ? err.status : err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
