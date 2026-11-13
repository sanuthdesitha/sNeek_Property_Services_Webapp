import { NextRequest, NextResponse } from "next/server";
import { Role, JobStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
import { getEtaMinutes, geocodeAddress, type EtaMode } from "@/lib/jobs/eta";
import { LOCATION_NOTICE_REQUIRED, hasAcknowledgedLocationNotice } from "@/lib/gps/notice-server";
import { sendCleanerSharingNotice, sendStartWithoutFixNotice } from "@/lib/notifications/location-sharing";
import { ingestCleanerBatch } from "@/lib/gps/ingest-service";
import { NO_FIX_LABEL, noFixErrorLabel, noFixSchema } from "@/lib/gps/start-location";
import { sydneyTodayKey } from "@/lib/time/sydney-range";

const schema = z.object({
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  accuracy: z.number().nonnegative().optional().nullable(),
  /** Location allowed but no position could be had: go on the way with a reason. */
  noFix: noFixSchema.optional(),
});

/**
 * Live location is mandatory from "on the way" (default pending owner
 * confirmation, 2026-11-14): the cleaner must have accepted the current
 * location notice and the phone must have produced a fix. An administrator
 * viewing as the cleaner starts nothing that records location: no fix is
 * asked for or used.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const impersonating = Boolean(session.impersonation);
    if (!impersonating) {
      if (!(await hasAcknowledgedLocationNotice(session.user.id, "CLEANER"))) {
        return NextResponse.json(LOCATION_NOTICE_REQUIRED, { status: 409 });
      }
      if ((body.lat == null || body.lng == null) && !body.noFix) {
        return NextResponse.json({ error: "LOCATION_REQUIRED", message: "Turn on location for this app to start the drive. The office sees your location until you clock out." }, { status: 409 });
      }
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
        jobNumber: true,
        property: {
          select: {
            name: true,
            client: { select: { showCleanerLiveLocation: true } },
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

    const allowedStatuses: JobStatus[] = [JobStatus.ASSIGNED, "EN_ROUTE" as JobStatus];
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
    if (!impersonating && body.lat != null && body.lng != null) {
      etaMinutes = await getEtaMinutes({
        fromLat: body.lat,
        fromLng: body.lng,
        toLat: propLat,
        toLng: propLng,
        toAddress: propLat == null ? [job.property?.address, job.property?.suburb, "Australia"].filter(Boolean).join(", ") : null,
        mode: travelMode,
      });
    }

    await db.job.update({
      where: { id: params.id },
      data: {
        status: "EN_ROUTE" as JobStatus,
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
    if (!impersonating && body.lat != null && body.lng != null) {
      // The fix that opened the drive is the first live position (same ingest path).
      await ingestCleanerBatch({
        userId: session.user.id, impersonating: false, jobIdFromUrl: job.id,
        body: { pings: [{ lat: body.lat, lng: body.lng, accuracy: body.accuracy ?? null }] },
      }).catch(() => undefined);
    }
    if (!impersonating && (body.lat == null || body.lng == null) && body.noFix) {
      const noFix = body.noFix;
      await db.auditLog.create({
        data: {
          userId: session.user.id, jobId: job.id, action: "EN_ROUTE_START_NO_FIX", entity: "Job", entityId: job.id,
          after: { label: NO_FIX_LABEL, reason: noFix.reason, deviceError: noFix.error },
        },
      }).catch(() => undefined);
      await sendStartWithoutFixNotice({
        kind: "drive", scopeJobId: job.id, placeLabel: `${job.jobNumber || job.id}: ${job.property?.name ?? "the job"}`,
        personName: session.user.name ?? null, reason: noFix.reason, errorLabel: noFixErrorLabel(noFix.error),
        occurrenceId: `${job.id}:${sydneyTodayKey()}`,
      }).catch(() => undefined);
    }
    if (!impersonating) {
      await sendCleanerSharingNotice({
        kind: "started",
        userId: session.user.id,
        jobId: job.id,
        jobLabel: `${job.jobNumber || job.id}: ${job.property?.name ?? "the job"}`,
        clientSees: job.property?.client?.showCleanerLiveLocation === true,
        occurrenceId: `enroute:${job.id}:${sydneyTodayKey()}`,
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true, etaMinutes });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
