import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";

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
        arrivedAt: new Date(),
        drivingPausedAt: null,
        drivingPauseReason: null,
        enRouteEtaMinutes: 0,
        enRouteEtaUpdatedAt: new Date(),
      },
    });

    await sendClientJobNotification({ jobId: params.id, type: "EN_ROUTE_ARRIVED", etaMinutes: 0 });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
