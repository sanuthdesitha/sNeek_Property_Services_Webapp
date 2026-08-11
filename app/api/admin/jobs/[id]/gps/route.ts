import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { haversineMeters } from "@/lib/jobs/gps";

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date");

const pointSchema = z
  .object({
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    at: isoDate.nullable().optional(),
  })
  .refine(
    (p) => p.lat !== undefined || p.lng !== undefined || p.at !== undefined,
    "Nothing to update"
  )
  // lat/lng only make sense together — a point with one half cleared is junk.
  .refine(
    (p) => (p.lat === null) === (p.lng === null) || p.lat === undefined || p.lng === undefined,
    "Latitude and longitude must be set or cleared together"
  );

const patchSchema = z
  .object({
    checkIn: pointSchema.optional(),
    checkOut: pointSchema.optional(),
    note: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((b) => b.checkIn || b.checkOut || b.note !== undefined, "Nothing to update");

/**
 * Admin edit of a job's recorded GPS check-in / check-out. Marks the check-in
 * as admin-adjusted and writes a before/after AuditLog so the original device
 * capture is never silently lost.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        gpsCheckInLat: true,
        gpsCheckInLng: true,
        gpsCheckInAt: true,
        gpsCheckOutLat: true,
        gpsCheckOutLng: true,
        gpsCheckOutAt: true,
        gpsCheckInAdjusted: true,
        gpsCheckInNote: true,
        gpsDistanceMeters: true,
        property: { select: { latitude: true, longitude: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.checkIn) {
      if (body.checkIn.lat !== undefined) data.gpsCheckInLat = body.checkIn.lat;
      if (body.checkIn.lng !== undefined) data.gpsCheckInLng = body.checkIn.lng;
      if (body.checkIn.at !== undefined) {
        data.gpsCheckInAt = body.checkIn.at === null ? null : new Date(body.checkIn.at);
      }
      data.gpsCheckInAdjusted = true;

      // The report's "distance from property at check-in" derives from these
      // coordinates — recompute it or the corrected pin ships a stale number.
      const finalLat =
        body.checkIn.lat !== undefined ? body.checkIn.lat : job.gpsCheckInLat;
      const finalLng =
        body.checkIn.lng !== undefined ? body.checkIn.lng : job.gpsCheckInLng;
      data.gpsDistanceMeters =
        finalLat != null &&
        finalLng != null &&
        job.property?.latitude != null &&
        job.property?.longitude != null
          ? Math.round(
              haversineMeters(finalLat, finalLng, job.property.latitude, job.property.longitude)
            )
          : null;
    }
    if (body.checkOut) {
      if (body.checkOut.lat !== undefined) data.gpsCheckOutLat = body.checkOut.lat;
      if (body.checkOut.lng !== undefined) data.gpsCheckOutLng = body.checkOut.lng;
      if (body.checkOut.at !== undefined) {
        data.gpsCheckOutAt = body.checkOut.at === null ? null : new Date(body.checkOut.at);
      }
    }
    if (body.note !== undefined) data.gpsCheckInNote = body.note || null;

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.job.update({
        where: { id: job.id },
        data,
        select: {
          id: true,
          gpsCheckInLat: true,
          gpsCheckInLng: true,
          gpsCheckInAt: true,
          gpsCheckOutLat: true,
          gpsCheckOutLng: true,
          gpsCheckOutAt: true,
          gpsCheckInAdjusted: true,
          gpsCheckInNote: true,
          gpsDistanceMeters: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: job.id,
          action: "ADMIN_EDIT_JOB_GPS",
          entity: "Job",
          entityId: job.id,
          before: {
            gpsCheckInLat: job.gpsCheckInLat,
            gpsCheckInLng: job.gpsCheckInLng,
            gpsCheckInAt: job.gpsCheckInAt?.toISOString() ?? null,
            gpsCheckOutLat: job.gpsCheckOutLat,
            gpsCheckOutLng: job.gpsCheckOutLng,
            gpsCheckOutAt: job.gpsCheckOutAt?.toISOString() ?? null,
            gpsCheckInNote: job.gpsCheckInNote,
            gpsDistanceMeters: job.gpsDistanceMeters,
          } as any,
          after: {
            gpsCheckInLat: row.gpsCheckInLat,
            gpsCheckInLng: row.gpsCheckInLng,
            gpsCheckInAt: row.gpsCheckInAt?.toISOString() ?? null,
            gpsCheckOutLat: row.gpsCheckOutLat,
            gpsCheckOutLng: row.gpsCheckOutLng,
            gpsCheckOutAt: row.gpsCheckOutAt?.toISOString() ?? null,
            gpsCheckInNote: row.gpsCheckInNote,
            gpsDistanceMeters: row.gpsDistanceMeters,
          } as any,
        },
      });

      return row;
    });

    // Keep any already-generated report in step with the corrected GPS record.
    void refreshReportIfExists(job.id);

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

async function refreshReportIfExists(jobId: string): Promise<void> {
  try {
    const report = await db.report.findUnique({ where: { jobId }, select: { id: true } });
    if (!report) return;
    const { generateJobReport } = await import("@/lib/reports/generator");
    await generateJobReport(jobId);
  } catch (err) {
    logger.error({ err, jobId }, "Report refresh after GPS edit failed");
  }
}
