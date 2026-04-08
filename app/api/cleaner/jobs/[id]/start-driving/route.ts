import { NextRequest, NextResponse } from "next/server";
import { Role, JobStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
import { getEtaMinutes, geocodeAddress } from "@/lib/jobs/eta";

const schema = z.object({
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: {
        id: true,
        status: true,
        property: {
          select: {
            id: true,
            latitude: true,
            longitude: true,
            address: true,
            suburb: true,
            state: true,
          },
        },
      },
    });

    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const allowedStatuses: JobStatus[] = [JobStatus.ASSIGNED, JobStatus.EN_ROUTE];
    if (!allowedStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: "Job must be in ASSIGNED status to start driving." },
        { status: 400 }
      );
    }

    // Auto-geocode property if lat/lng missing
    let propLat = job.property?.latitude;
    let propLng = job.property?.longitude;
    if ((propLat == null || propLng == null) && job.property?.address) {
      const fullAddress = [job.property.address, job.property.suburb, job.property.state, "Australia"]
        .filter(Boolean).join(", ");
      const coords = await geocodeAddress(fullAddress);
      if (coords) {
        propLat = coords.lat;
        propLng = coords.lng;
        await db.property.update({
          where: { id: job.property.id },
          data: { latitude: coords.lat, longitude: coords.lng },
        });
      }
    }

    // Calculate initial ETA
    let etaMinutes: number | null = null;
    if (body.lat != null && body.lng != null) {
      etaMinutes = await getEtaMinutes({
        fromLat: body.lat,
        fromLng: body.lng,
        toLat: propLat,
        toLng: propLng,
        toAddress: propLat == null ? [job.property?.address, job.property?.suburb, "Australia"].filter(Boolean).join(", ") : null,
      });
    }

    await db.job.update({
      where: { id: params.id },
      data: {
        status: JobStatus.EN_ROUTE,
        enRouteStartedAt: new Date(),
        enRouteEtaMinutes: etaMinutes,
        enRouteEtaUpdatedAt: etaMinutes != null ? new Date() : null,
        drivingPausedAt: null,
        drivingPauseReason: null,
        drivingDelayedAt: null,
        drivingDelayedReason: null,
        arrivedAt: null,
      },
    });

    await sendClientJobNotification({ jobId: params.id, type: "EN_ROUTE", etaMinutes });

    return NextResponse.json({ ok: true, etaMinutes });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
