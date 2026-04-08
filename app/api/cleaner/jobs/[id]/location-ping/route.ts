import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getEtaMinutes, geocodeAddress } from "@/lib/jobs/eta";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional().nullable(),
  heading: z.number().optional().nullable(),
  speed: z.number().optional().nullable(),
  manualEtaMinutes: z.number().int().min(1).max(480).optional().nullable(),
});

const PING_INTERVAL_MS = 10_000;
const ETA_NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000;
const ETA_CHANGE_THRESHOLD_MINUTES = 5;
const DELAY_THRESHOLD_MINUTES = 10;
const ETA_BAND_THRESHOLDS = [45, 20, 10, 5] as const;

function parseScheduledStartAt(scheduledDate: Date, hhmm: string | null | undefined) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [hours, minutes] = hhmm.split(":").map((value) => Number(value));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return new Date(
    Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
      hours,
      minutes,
      0,
      0
    )
  );
}

function crossedEtaBand(previousEta: number | null, nextEta: number | null) {
  if (previousEta == null || nextEta == null) return false;
  return ETA_BAND_THRESHOLDS.some((threshold) => previousEta > threshold && nextEta <= threshold);
}

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
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        arrivedAt: true,
        drivingPausedAt: true,
        drivingDelayedAt: true,
        drivingDelayedReason: true,
        enRouteEtaMinutes: true,
        lastEtaNotificationAt: true,
        lastEtaNotifiedMinutes: true,
        lastDelayedNotificationAt: true,
        property: { select: { id: true, latitude: true, longitude: true, address: true, suburb: true, state: true } },
      },
    });

    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status !== JobStatus.EN_ROUTE) {
      return NextResponse.json({ error: "Job is not actively en route." }, { status: 400 });
    }

    const recentPing = await db.cleanerLocationPing.findFirst({
      where: {
        jobId: params.id,
        userId: session.user.id,
        timestamp: { gte: new Date(Date.now() - PING_INTERVAL_MS) },
      },
      select: { id: true },
    });

    if (recentPing) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    await db.cleanerLocationPing.create({
      data: {
        jobId: params.id,
        userId: session.user.id,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy ?? null,
        heading: body.heading ?? null,
        speed: body.speed ?? null,
      },
    });

    if (job.arrivedAt) {
      return NextResponse.json({ ok: true, skipped: false, etaMinutes: job.enRouteEtaMinutes });
    }

    const propLat = job.property?.latitude;
    const propLng = job.property?.longitude;
    const propAddress = [job.property?.address, job.property?.suburb, job.property?.state, "Australia"]
      .filter(Boolean).join(", ");

    // Auto-geocode property if lat/lng missing
    let resolvedPropLat = propLat;
    let resolvedPropLng = propLng;
    if ((propLat == null || propLng == null) && job.property?.address && job.property?.id) {
      const coords = await geocodeAddress(propAddress);
      if (coords) {
        resolvedPropLat = coords.lat;
        resolvedPropLng = coords.lng;
        await db.property.update({
          where: { id: job.property.id },
          data: { latitude: coords.lat, longitude: coords.lng },
        });
      }
    }

    // Use manual ETA if provided, otherwise compute from GPS
    let etaMinutes: number | null;
    if (body.manualEtaMinutes != null) {
      etaMinutes = body.manualEtaMinutes;
    } else {
      const canComputeEta = !job.drivingPausedAt;
      etaMinutes = canComputeEta
        ? await getEtaMinutes({
            fromLat: body.lat,
            fromLng: body.lng,
            toLat: resolvedPropLat,
            toLng: resolvedPropLng,
            toAddress: resolvedPropLat == null ? propAddress : null,
          })
        : job.enRouteEtaMinutes;
    }

    const scheduledStartAt = parseScheduledStartAt(job.scheduledDate, job.startTime);
    const predictedArrivalAt = etaMinutes != null ? new Date(Date.now() + etaMinutes * 60_000) : null;
    const isAutoDelayed =
      !job.drivingPausedAt &&
      Boolean(
        scheduledStartAt &&
          predictedArrivalAt &&
          predictedArrivalAt.getTime() - scheduledStartAt.getTime() >= DELAY_THRESHOLD_MINUTES * 60_000
      );
    const enteringAutoDelayed = isAutoDelayed && !job.drivingDelayedAt;

    await db.job.update({
      where: { id: params.id },
      data: {
        enRouteEtaMinutes: etaMinutes,
        enRouteEtaUpdatedAt: etaMinutes != null && !job.drivingPausedAt ? new Date() : undefined,
        drivingDelayedAt: enteringAutoDelayed ? new Date() : job.drivingDelayedAt,
        drivingDelayedReason: enteringAutoDelayed
          ? "AUTO_TRAFFIC"
          : !isAutoDelayed && job.drivingDelayedReason === "AUTO_TRAFFIC"
          ? null
          : job.drivingDelayedReason,
      },
    });

    if (job.drivingPausedAt) {
      return NextResponse.json({ ok: true, skipped: false, etaMinutes, paused: true });
    }

    const now = Date.now();
    const lastEtaNotificationAt = job.lastEtaNotificationAt?.getTime() ?? 0;
    const etaChangedMaterially =
      etaMinutes != null &&
      job.lastEtaNotifiedMinutes != null &&
      Math.abs(etaMinutes - job.lastEtaNotifiedMinutes) >= ETA_CHANGE_THRESHOLD_MINUTES;
    const crossedBand = crossedEtaBand(job.lastEtaNotifiedMinutes, etaMinutes);
    const delayNotificationDue = enteringAutoDelayed && now - (job.lastDelayedNotificationAt?.getTime() ?? 0) >= ETA_NOTIFICATION_INTERVAL_MS;
    const etaNotificationDueByTime = now - lastEtaNotificationAt >= ETA_NOTIFICATION_INTERVAL_MS;
    const shouldSendEtaUpdate =
      etaMinutes != null && (delayNotificationDue || crossedBand || (etaChangedMaterially && etaNotificationDueByTime));

    if (shouldSendEtaUpdate) {
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
          ...(delayNotificationDue ? { lastDelayedNotificationAt: new Date() } : {}),
        },
      });
    }

    return NextResponse.json({ ok: true, skipped: false, etaMinutes, delayed: isAutoDelayed });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
