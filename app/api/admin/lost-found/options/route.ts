import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const RECENT_DAYS = 45;

/**
 * GET — choices for "Log an item": active properties, and with `propertyId`
 * that property's recent jobs (last 45 days and the next 2), newest first,
 * saying whether each job has a booking whose guest would be copied.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const propertyId = req.nextUrl.searchParams.get("propertyId")?.trim() || null;
    const properties = await db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" } });
    if (!propertyId) return NextResponse.json({ properties, jobs: [] });
    const now = Date.now();
    const jobs = await db.job.findMany({
      where: { propertyId, scheduledDate: { gte: new Date(now - RECENT_DAYS * 86_400_000), lte: new Date(now + 2 * 86_400_000) } },
      select: { id: true, jobNumber: true, scheduledDate: true, jobType: true, status: true, reservation: { select: { guestName: true, reservationCode: true } } },
      orderBy: { scheduledDate: "desc" },
      take: 60,
    });
    return NextResponse.json({
      properties,
      jobs: jobs.map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber,
        scheduledDate: job.scheduledDate.toISOString(),
        jobType: job.jobType,
        status: job.status,
        hasBooking: Boolean(job.reservation),
        bookingGuest: job.reservation?.guestName?.trim() || null,
        bookingCode: job.reservation?.reservationCode?.trim() || null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load choices.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
