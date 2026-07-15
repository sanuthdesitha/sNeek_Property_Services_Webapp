import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { JobStatus, Role } from "@prisma/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);

    // Ownership: only the assigned cleaner may pause this job (parity with every
    // other job-scoped cleaner route).
    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }

    const openLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (!openLog)
      return NextResponse.json({ error: "No active time log" }, { status: 400 });

    const now = new Date();
    const durationM = Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000);

    await db.timeLog.update({
      where: { id: openLog.id },
      data: { stoppedAt: now, durationM },
    });

    // Only move an actively-running job to PAUSED — never drag a job that has
    // advanced to SUBMITTED/QA_REVIEW/COMPLETED/INVOICED back (a stale open log
    // or another cleaner's clock-out shouldn't reopen a finished job).
    await db.job.updateMany({
      where: {
        id: params.id,
        status: {
          notIn: [
            JobStatus.SUBMITTED,
            JobStatus.QA_REVIEW,
            JobStatus.COMPLETED,
            JobStatus.INVOICED,
          ],
        },
      },
      data: { status: JobStatus.PAUSED },
    });

    return NextResponse.json({ ok: true, durationM });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
