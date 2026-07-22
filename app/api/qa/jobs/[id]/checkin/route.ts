import { NextRequest, NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/jobs/gps";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * POST /api/qa/jobs/[id]/checkin — QA ARRIVAL check-in.
 *
 * Mirrors the cleaner GPS check-in (app/api/cleaner/jobs/[id]/gps-checkin):
 * the arrival stamp is IMMUTABLE. Re-entering the inspection later must never
 * overwrite the original coordinates, so an existing `checkInAt` short-circuits
 * with `{ preserved: true }`.
 *
 * `skippedReason` records a REMOTE review — the inspector could not physically
 * check in (desk review, gate access refused, GPS dead) and the review is
 * flagged accordingly. Either path auto-starts the on-site timer.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const body = (await req.json().catch(() => ({}))) as {
      lat?: unknown;
      lng?: unknown;
      accuracy?: unknown;
      skippedReason?: unknown;
    };
    const lat = toNumber(body.lat);
    const lng = toNumber(body.lng);
    const accuracy = toNumber(body.accuracy);
    const skippedReason =
      typeof body.skippedReason === "string" && body.skippedReason.trim()
        ? body.skippedReason.trim().slice(0, 1000)
        : null;

    if (!skippedReason && (lat == null || lng == null)) {
      return NextResponse.json(
        { error: "GPS coordinates are required — or give a reason for reviewing remotely." },
        { status: 400 }
      );
    }

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: { id: true, property: { select: { name: true, latitude: true, longitude: true } } },
    });
    if (!job) return NextResponse.json({ error: "QA job not found." }, { status: 404 });

    const assignment = await db.qaAssignment.findFirst({
      where: {
        jobId: params.id,
        status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
        OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
      },
      orderBy: { createdAt: "desc" },
    });
    // No assignment (ad-hoc admin review) — nothing to stamp; the inspection is
    // allowed to proceed and the client keeps a local timer.
    if (!assignment) {
      return NextResponse.json({ ok: true, persisted: false, remote: Boolean(skippedReason) });
    }

    // ARRIVAL IS IMMUTABLE — never overwrite an existing check-in.
    if (assignment.checkInAt) {
      return NextResponse.json({
        ok: true,
        preserved: true,
        checkInAt: assignment.checkInAt,
        checkInLat: assignment.checkInLat,
        checkInLng: assignment.checkInLng,
        checkInAccuracyM: assignment.checkInAccuracyM,
        checkInSkippedReason: assignment.checkInSkippedReason,
        distanceMeters:
          assignment.checkInLat != null &&
          assignment.checkInLng != null &&
          job.property?.latitude != null &&
          job.property?.longitude != null
            ? haversineMeters(
                assignment.checkInLat,
                assignment.checkInLng,
                job.property.latitude,
                job.property.longitude
              )
            : null,
      });
    }

    const propertyLat = toNumber(job.property?.latitude);
    const propertyLng = toNumber(job.property?.longitude);
    const distanceMeters =
      lat != null && lng != null && propertyLat != null && propertyLng != null
        ? haversineMeters(lat, lng, propertyLat, propertyLng)
        : null;

    const now = new Date();
    const updated = await db.qaAssignment.update({
      where: { id: assignment.id },
      data: {
        checkInAt: now,
        checkInLat: lat ?? null,
        checkInLng: lng ?? null,
        checkInAccuracyM: accuracy ?? null,
        checkInSkippedReason: skippedReason,
        // Arrival starts the on-site clock (same semantics as the timer route).
        status: QaAssignmentStatus.IN_PROGRESS,
        pickedUpById: assignment.pickedUpById ?? session.user.id,
        pickedUpAt: assignment.pickedUpAt ?? now,
        onSiteStartedAt: assignment.onSiteStartedAt ?? now,
        onSiteEndedAt: null,
      },
    });

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action: skippedReason ? "QA_CHECKIN_REMOTE" : "QA_CHECKIN",
          entity: "QaAssignment",
          entityId: assignment.id,
          after: { lat, lng, accuracy, distanceMeters, skippedReason } as any,
        },
      })
      .catch(() => undefined);

    const lowAccuracy = accuracy != null && accuracy > 200;
    return NextResponse.json({
      ok: true,
      persisted: true,
      remote: Boolean(skippedReason),
      checkInAt: updated.checkInAt,
      onSiteStartedAt: updated.onSiteStartedAt,
      onSiteMinutes: updated.onSiteMinutes ?? 0,
      distanceMeters,
      accuracy,
      lowAccuracy,
      message: skippedReason
        ? "Remote review recorded — the inspection is flagged as reviewed off-site."
        : lowAccuracy
          ? `Checked in, but the GPS fix is only accurate to ±${Math.round(accuracy!)}m.`
          : distanceMeters != null
            ? `Checked in ${distanceMeters}m from the property.`
            : "Checked in.",
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not record the QA check-in." }, { status });
  }
}
