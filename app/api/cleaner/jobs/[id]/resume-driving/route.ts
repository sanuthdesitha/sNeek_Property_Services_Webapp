import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getEtaMinutes } from "@/lib/jobs/eta";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = await req.json().catch(() => ({}));
    const lat = typeof body?.lat === "number" ? body.lat : null;
    const lng = typeof body?.lng === "number" ? body.lng : null;

    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: {
        id: true,
        status: true,
        arrivedAt: true,
        property: { select: { latitude: true, longitude: true } },
      },
    });

    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status !== JobStatus.EN_ROUTE || job.arrivedAt) {
      return NextResponse.json({ error: "Job is not actively en route." }, { status: 400 });
    }

    let etaMinutes: number | null = null;
    const propLat = job.property?.latitude;
    const propLng = job.property?.longitude;
    if (lat != null && lng != null && propLat != null && propLng != null) {
      etaMinutes = await getEtaMinutes({
        fromLat: lat,
        fromLng: lng,
        toLat: propLat,
        toLng: propLng,
      });
    }

    await db.job.update({
      where: { id: params.id },
      data: {
        drivingPausedAt: null,
        drivingPauseReason: null,
        enRouteEtaMinutes: etaMinutes,
        enRouteEtaUpdatedAt: etaMinutes != null ? new Date() : undefined,
      },
    });

    if (etaMinutes != null) {
      await sendClientJobNotification({
        jobId: params.id,
        type: "EN_ROUTE_UPDATE",
        etaMinutes,
      });

      await db.job.update({
        where: { id: params.id },
        data: {
          lastEtaNotificationAt: new Date(),
          lastEtaNotifiedMinutes: etaMinutes,
        },
      });
    }

    return NextResponse.json({ ok: true, etaMinutes });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
