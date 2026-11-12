import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getEtaMinutes, geocodeAddress, type EtaMode } from "@/lib/jobs/eta";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
import { ingestCleanerBatch } from "@/lib/gps/ingest-service";
import { TRACKING_REFUSAL_TEXT, resolveCleanerJobWindow } from "@/lib/gps/tracking-window";

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional().nullable(),
  heading: z.number().optional().nullable(),
  speed: z.number().optional().nullable(),
  manualEtaMinutes: z.number().int().min(1).max(480).optional().nullable(),
  /** When the fix was measured on the phone (ISO); absent from older clients. */
  timestamp: z.string().datetime().optional(),
  /** The phone's clock when it sent, for skew correction. */
  sentAt: z.string().datetime().optional(),
  /**
   * false: the fix came from the layout tracker, which already stores it
   * (one capture loop per device); this call only recomputes the ETA.
   */
  record: z.boolean().optional(),
});
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
    // An administrator viewing as the cleaner is never a location source: no
    // fix is stored and no ETA (which reaches the client) is computed from it.
    if (session.impersonation) {
      return NextResponse.json({ ok: true, skipped: true, reason: "IMPERSONATING" });
    }

    const cleaner = await db.user.findUnique({
      where: { id: session.user.id },
      select: { preferredTransport: true },
    });
    const travelMode = (cleaner?.preferredTransport ?? "DRIVING").toLowerCase() as EtaMode;

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

    // Store through the one ingest path (tracking window, skew correction,
    // idempotency, latest position, geofence). Outside the window (not today,
    // clock stopped, not on the way) nothing is stored and no ETA is computed.
    if (body.record !== false) {
      const outcome = await ingestCleanerBatch({
        userId: session.user.id,
        impersonating: false,
        jobIdFromUrl: params.id,
        body: {
          ...(body.sentAt ? { sentAt: body.sentAt } : {}),
          pings: [{ lat: body.lat, lng: body.lng, accuracy: body.accuracy ?? null, heading: body.heading ?? null, speed: body.speed ?? null, ...(body.timestamp ? { timestamp: body.timestamp } : {}) }],
        },
      });
      if (outcome.status === 429) return NextResponse.json({ ok: true, skipped: true, etaMinutes: job.enRouteEtaMinutes });
      if (outcome.status !== 200) return NextResponse.json(outcome.body, { status: outcome.status });
      if (!outcome.body.window.active) {
        return NextResponse.json({ error: "Job is not active.", reason: outcome.body.window.reason, message: outcome.body.window.message }, { status: 400 });
      }
    } else {
      const window = await resolveCleanerJobWindow({ userId: session.user.id, jobId: params.id, impersonating: false });
      if (!window.ok) {
        return NextResponse.json({ error: "Job is not active.", reason: window.reason, message: TRACKING_REFUSAL_TEXT[window.reason] }, { status: 400 });
      }
    }

    // Everything below is ETA/delay maths for a cleaner still driving. Once
    // they have arrived — or the job has moved past EN_ROUTE — the ping has
    // been recorded and there is no journey left to estimate.
    if (job.arrivedAt || job.status !== ("EN_ROUTE" as JobStatus)) {
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
            mode: travelMode,
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
