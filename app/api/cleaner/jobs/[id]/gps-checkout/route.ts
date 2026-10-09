import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordCheckoutLocation } from "@/lib/jobs/checkout-location";
import { haversineMeters } from "@/lib/jobs/gps";

function toNumber(value: unknown) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = (await req.json().catch(() => ({}))) as { lat?: unknown; lng?: unknown; timeLogId?: unknown };
    const lat = toNumber(body.lat);
    const lng = toNumber(body.lng);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: "GPS coordinates are required." }, { status: 400 });
    }

    if (typeof body.timeLogId !== "string" || !body.timeLogId.trim()) {
      return NextResponse.json({ error: "A newly recorded clock-out is required.", code: "CLOCK_OUT_REQUIRED" }, { status: 409 });
    }
    const timeLogId = body.timeLogId;

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

    const result = await db.$transaction(tx => recordCheckoutLocation(tx, {
      jobId: job.id, userId: session.user.id, timeLogId, lat, lng,
    }));
    return NextResponse.json({ ok: true, ...result, ...(result.recorded ? { distanceMeters } : {}) });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not store GPS check-out." }, { status });
  }
}
