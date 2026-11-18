import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { payRequestEditLock } from "@/lib/pay-adjustments/lifecycle";

/**
 * Jobs an unlinked pay request may be linked to (2026-11-18): jobs its OWN
 * cleaner is actively assigned to, at the request's property when it has one,
 * nearest to the date the request was raised (two weeks either side). The
 * PATCH re-checks the same rule (`jobLinkRefusal`) before writing anything, so
 * this list is a convenience, never the guard.
 */
const WINDOW_DAYS = 14;
const LIMIT = 20;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const request = await db.cleanerPayAdjustment.findUnique({ where: { id: params.id } });
    if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    const lock = payRequestEditLock(request);
    if (!lock.editable) return NextResponse.json({ jobs: [], refusal: lock.reason });

    const centre = request.requestedAt.getTime();
    const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const jobs = await db.job.findMany({
      where: {
        assignments: { some: { userId: request.cleanerId, removedAt: null } },
        status: { notIn: [JobStatus.CANCELLED, JobStatus.UNASSIGNED, JobStatus.OFFERED] },
        ...(request.propertyId ? { propertyId: request.propertyId } : {}),
        scheduledDate: { gte: new Date(centre - windowMs), lte: new Date(centre + windowMs) },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        property: { select: { id: true, name: true, suburb: true } },
      },
      take: 60,
    });
    const nearest = jobs
      .sort((a, b) => Math.abs(a.scheduledDate.getTime() - centre) - Math.abs(b.scheduledDate.getTime() - centre))
      .slice(0, LIMIT)
      .map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber ?? null,
        jobType: String(job.jobType),
        status: String(job.status),
        scheduledDate: job.scheduledDate.toISOString(),
        propertyName: job.property.suburb ? `${job.property.name} (${job.property.suburb})` : job.property.name,
      }));
    return NextResponse.json({
      jobs: nearest,
      refusal: null,
      scope: request.propertyId ? "Same property, same cleaner, within two weeks of the request." : "Same cleaner, within two weeks of the request.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not load jobs.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
