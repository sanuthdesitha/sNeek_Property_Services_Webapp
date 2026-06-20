import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { JobStatus, Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";

/**
 * Clock out WITHOUT completing the job form — only for cleaners the admin has
 * allowlisted. Stops the running clock and parks the job as "form pending":
 * it is explicitly NOT completed (stays PAUSED) until the cleaner returns and
 * submits the form (which then flows SUBMITTED → QA as usual).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const settings = await getAppSettings();
    if (!settings.clockOutWithoutFormAllowedCleanerIds.includes(session.user.id)) {
      return NextResponse.json(
        { error: "You're not allowed to clock out before completing the form. Ask an admin to enable this for you." },
        { status: 403 }
      );
    }

    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job." }, { status: 403 });
    }

    const job = await db.job.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (([JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED] as JobStatus[]).includes(job.status)) {
      return NextResponse.json({ error: "This job is already submitted/completed." }, { status: 400 });
    }

    const openLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
      orderBy: { startedAt: "desc" },
    });

    const now = new Date();
    let durationM: number | null = null;
    if (openLog) {
      durationM = Math.max(0, Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000));
      await db.timeLog.update({ where: { id: openLog.id }, data: { stoppedAt: now, durationM } });
    }

    await db.job.update({
      where: { id: params.id },
      // PAUSED + a "form pending" flag: clocked out, but NOT completed until the
      // form is submitted. The job won't be billed/QA'd until then.
      data: { status: JobStatus.PAUSED, formPendingAfterClockOut: true, clockedOutEarlyAt: now },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: "CLOCK_OUT_EARLY",
        entity: "Job",
        entityId: params.id,
        after: { durationM, formPending: true } as any,
      },
    });

    return NextResponse.json({ ok: true, durationM });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
