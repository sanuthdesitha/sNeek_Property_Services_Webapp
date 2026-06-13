import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/jobs/gps";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = (await req.json().catch(() => ({}))) as {
      lat?: unknown;
      lng?: unknown;
      accuracy?: unknown;
      confirmed?: unknown;
      adjusted?: unknown;
      note?: unknown;
    };
    const lat = toNumber(body.lat);
    const lng = toNumber(body.lng);
    const accuracy = toNumber(body.accuracy);
    const confirmed = body.confirmed === true;
    const adjusted = body.adjusted === true;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
    if (lat == null || lng == null) {
      return NextResponse.json({ error: "GPS coordinates are required." }, { status: 400 });
    }

    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: {
        id: true,
        property: { select: { name: true, latitude: true, longitude: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const propertyLat = toNumber(job.property?.latitude);
    const propertyLng = toNumber(job.property?.longitude);
    const distanceMeters =
      propertyLat != null && propertyLng != null ? haversineMeters(lat, lng, propertyLat, propertyLng) : null;

    const now = new Date();
    await db.job.update({
      where: { id: job.id },
      data: {
        gpsCheckInLat: lat,
        gpsCheckInLng: lng,
        gpsCheckInAt: now,
        gpsDistanceMeters: distanceMeters,
        gpsCheckInAccuracyM: accuracy ?? undefined,
        gpsCheckInConfirmed: confirmed,
        gpsCheckInAdjusted: adjusted,
        gpsCheckInNote: note,
      },
    });

    // Attach the confirmed location to the job's form submission data so it
    // travels with job-related forms. If no submission exists yet (check-in
    // typically happens before the cleaner submits the form), the durable
    // source remains the Job.gpsCheckIn* fields above.
    const checkinLocation = {
      lat,
      lng,
      accuracy: accuracy ?? null,
      adjusted,
      confirmed,
      note: note || null,
      at: now.toISOString(),
    };
    try {
      const latestSubmission = await db.formSubmission.findFirst({
        where: { jobId: job.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, data: true },
      });
      if (latestSubmission) {
        const data =
          latestSubmission.data && typeof latestSubmission.data === "object" && !Array.isArray(latestSubmission.data)
            ? (latestSubmission.data as Record<string, unknown>)
            : {};
        await db.formSubmission.update({
          where: { id: latestSubmission.id },
          data: { data: { ...data, __checkinLocation: checkinLocation } as any },
        });
      }
    } catch (err) {
      console.error("[gps-checkin] could not attach location to form submission", err);
    }

    // When the cleaner adjusts the auto-detected location, alert admins and
    // leave a note so the manual override is reviewable.
    if (adjusted) {
      await notifyAdminsByPush({
        jobId: job.id,
        subject: "Cleaner adjusted GPS check-in",
        body: `${job.property?.name ?? "A job"}: ${session.user.name ?? "Cleaner"} manually adjusted their check-in location${
          distanceMeters != null ? ` (~${distanceMeters}m from property)` : ""
        }.${note ? ` Note: ${note}` : ""}`,
      }).catch(() => undefined);

      await db.auditLog
        .create({
          data: {
            userId: session.user.id,
            jobId: job.id,
            action: "GPS_CHECKIN_ADJUSTED",
            entity: "Job",
            entityId: job.id,
            after: { lat, lng, accuracy, distanceMeters, note } as any,
          },
        })
        .catch(() => undefined);
    }

    const lowAccuracy = accuracy != null && accuracy > 200;
    return NextResponse.json({
      ok: true,
      distanceMeters,
      accuracy,
      lowAccuracy,
      confirmed,
      adjusted,
      message: lowAccuracy
        ? `Check-in recorded, but the GPS fix is only accurate to ±${Math.round(accuracy)}m — the distance to the property may be unreliable.`
        : distanceMeters != null
          ? `Check-in recorded ${distanceMeters}m from the property.`
          : "Check-in recorded.",
    });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not store GPS check-in." }, { status });
  }
}
