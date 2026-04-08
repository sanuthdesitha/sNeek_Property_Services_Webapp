import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";

const schema = z.object({
  reason: z.string().trim().min(1).max(120),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json());

    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: { id: true, status: true, arrivedAt: true, enRouteEtaMinutes: true },
    });

    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status !== JobStatus.EN_ROUTE || job.arrivedAt) {
      return NextResponse.json({ error: "Job is not actively en route." }, { status: 400 });
    }

    await db.job.update({
      where: { id: params.id },
      data: {
        drivingDelayedAt: new Date(),
        drivingDelayedReason: body.reason,
        lastDelayedNotificationAt: new Date(),
      },
    });

    await sendClientJobNotification({
      jobId: params.id,
      type: "EN_ROUTE_UPDATE",
      etaMinutes: job.enRouteEtaMinutes,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
