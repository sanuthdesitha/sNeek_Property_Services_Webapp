import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { haversineMeters } from "@/lib/jobs/gps";

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
    };
    const lat = toNumber(body.lat);
    const lng = toNumber(body.lng);
    const accuracy = toNumber(body.accuracy);
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
        property: { select: { latitude: true, longitude: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const propertyLat = toNumber(job.property?.latitude);
    const propertyLng = toNumber(job.property?.longitude);
    const distanceMeters =
      propertyLat != null && propertyLng != null ? haversineMeters(lat, lng, propertyLat, propertyLng) : null;

    await db.job.update({
      where: { id: job.id },
      data: {
        gpsCheckInLat: lat,
        gpsCheckInLng: lng,
        gpsCheckInAt: new Date(),
        gpsDistanceMeters: distanceMeters,
      },
    });

    // No schema change: accuracy is echoed back (not stored) so the client
    // can show "±25 m" and flag unreliable fixes instead of presenting a
    // misleading distance.
    const lowAccuracy = accuracy != null && accuracy > 200;
    return NextResponse.json({
      ok: true,
      distanceMeters,
      accuracy,
      lowAccuracy,
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
