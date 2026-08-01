import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/jobs/gps";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { classifyCheckInLocation, resolveOnSiteRadius } from "@/lib/gps/distance";
import { OFF_SITE_REASON_CODES, isValidOffSiteReason, offSiteReasonLabel } from "@/lib/gps/off-site-reasons";

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
      /** Coded reason, required when the fix is beyond the on-site radius. */
      reasonCode?: unknown;
    };
    const lat = toNumber(body.lat);
    const lng = toNumber(body.lng);
    const accuracy = toNumber(body.accuracy);
    const confirmed = body.confirmed === true;
    const adjusted = body.adjusted === true;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
    const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : null;
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
        gpsCheckInAt: true,
        arrivedAt: true,
        property: {
          select: { name: true, latitude: true, longitude: true, geofenceRadiusM: true },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // The arrival check-in is IMMUTABLE. Re-entering a job later (e.g. to finish
    // the form after clocking out) used to re-run the full clock-in and stamp
    // the cleaner's CURRENT position over the original arrival coordinates —
    // destroying the arrival evidence. Later fixes are still captured by the
    // CleanerLocationPing stream; only an explicit admin adjustment may rewrite
    // the arrival record.
    if (job.gpsCheckInAt && !adjusted) {
      return NextResponse.json({ ok: true, preserved: true, gpsCheckInAt: job.gpsCheckInAt });
    }

    const propertyLat = toNumber(job.property?.latitude);
    const propertyLng = toNumber(job.property?.longitude);
    const distanceMeters =
      propertyLat != null && propertyLng != null ? haversineMeters(lat, lng, propertyLat, propertyLng) : null;

    // THE GATE. Distance used to be computed, stored, and then ignored — a
    // check-in 40 km away returned 200 OK with a friendly "Check-in recorded
    // 40219m from the property." Beyond the radius we now require a CODED
    // reason before recording anything, so an off-site start is a deliberate,
    // attributable act rather than a number nobody reads.
    //
    // An unreliable fix (accuracy worse than ~200 m) is NOT treated as off
    // site: a ±3 km fix proves nothing either way, and accusing someone
    // standing in the kitchen of being elsewhere destroys trust in the gate.
    const verdict = classifyCheckInLocation({
      distanceM: distanceMeters,
      accuracyM: accuracy,
      radiusM: job.property?.geofenceRadiusM ?? null,
    });
    if (verdict === "OFF_SITE" && !isValidOffSiteReason(reasonCode)) {
      return NextResponse.json(
        {
          error: "OFF_SITE_REASON_REQUIRED",
          message: `You're about ${Math.round(distanceMeters ?? 0)} m from ${
            job.property?.name ?? "the property"
          }. Tell us why you're starting from here.`,
          distanceMeters: distanceMeters == null ? null : Math.round(distanceMeters),
          radiusM: resolveOnSiteRadius(job.property?.geofenceRadiusM ?? null),
          reasons: OFF_SITE_REASON_CODES,
        },
        { status: 409 }
      );
    }

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
        gpsCheckInReasonCode: verdict === "OFF_SITE" ? reasonCode : null,
        // STAMP ARRIVAL when the check-in is genuinely on site.
        //
        // `arrivedAt` was only ever set by an inside-fence PING, and
        // lib/gps/geofence.ts refuses to evaluate departure until it is set. A
        // cleaner whose phone never produced an accurate inside-fence ping —
        // coarse fixes, denied permission, app not opened on arrival — had
        // arrivedAt null forever, so auto-clock-out could NEVER fire for them.
        // An on-site check-in is the clearest arrival evidence there is.
        ...(verdict === "ON_SITE" && !job.arrivedAt ? { arrivedAt: now } : {}),
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

    // An off-site start is worth an admin's attention AND an audit row. The
    // note alone was never enough: nothing surfaced it, and nothing counted it.
    if (verdict === "OFF_SITE" && reasonCode) {
      await notifyAdminsByPush({
        jobId: job.id,
        subject: "Job started away from the property",
        body: `${job.property?.name ?? "A job"}: ${session.user.name ?? "Cleaner"} started ~${Math.round(
          distanceMeters ?? 0
        )}m away — ${offSiteReasonLabel(reasonCode)}.${note ? ` Note: ${note}` : ""}`,
      }).catch(() => undefined);

      await db.auditLog
        .create({
          data: {
            userId: session.user.id,
            jobId: job.id,
            action: "GPS_CHECKIN_OFF_SITE",
            entity: "Job",
            entityId: job.id,
            after: { lat, lng, accuracy, distanceMeters, reasonCode, note } as any,
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
      onSite: verdict === "ON_SITE",
      verdict,
      reasonCode: verdict === "OFF_SITE" ? reasonCode : null,
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
