import { NextRequest, NextResponse } from "next/server";
import { Role, JobStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: { id: true, status: true },
    });

    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status !== JobStatus.EN_ROUTE) {
      return NextResponse.json({ error: "Job is not in EN_ROUTE status." }, { status: 400 });
    }

    await db.job.update({
      where: { id: params.id },
      data: {
        status: JobStatus.ASSIGNED,
        enRouteStartedAt: null,
        enRouteEtaMinutes: null,
        enRouteEtaUpdatedAt: null,
        drivingPausedAt: null,
        drivingPauseReason: null,
        drivingDelayedAt: null,
        drivingDelayedReason: null,
        arrivedAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
