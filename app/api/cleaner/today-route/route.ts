import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDaysToKey, sydneyTodayKey, sydneyDayStart, sydneyDayEndInclusive } from "@/lib/time/sydney-range";
import { resolveTimingBadges } from "@/lib/jobs/timing-badges";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(req: Request) {
  try {
    return await loadRoute(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503;
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Route unavailable. Please retry." },
      { status, headers: privateHeaders },
    );
  }
}

async function loadRoute(req: Request) {
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  const { searchParams } = new URL(req.url);
  const relative = (searchParams.get("relative") || "").toLowerCase();
  const explicitDate = searchParams.get("date");

  if (explicitDate !== null && !isCalendarDate(explicitDate)) {
    return NextResponse.json({ error: "Invalid date. Use a valid YYYY-MM-DD calendar date." }, {
      status: 400, headers: privateHeaders,
    });
  }
  const today = sydneyTodayKey();
  const targetDate = relative === "tomorrow" ? addDaysToKey(today, 1) : explicitDate ?? today;
  const bounds = {
    date: targetDate,
    start: sydneyDayStart(targetDate),
    end: new Date(sydneyDayEndInclusive(targetDate).getTime() + 1),
  };

  const assignments = await db.jobAssignment.findMany({
    where: {
      userId: session.user.id,
      removedAt: null,
      job: {
        scheduledDate: { gte: bounds.start, lt: bounds.end },
        status: { notIn: ["COMPLETED", "INVOICED"] },
        // Skipped cleans are not actionable jobs for cleaners.
        cleanSkipStatus: { not: "SKIPPED" },
      },
    },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          status: true,
          startTime: true,
          dueTime: true,
          estimatedHours: true,
          internalNotes: true,
          sameDayCheckin: true,
          sameDayCheckinTime: true,
          enRouteStartedAt: true,
          enRouteEtaMinutes: true,
          arrivedAt: true,
          // Drive mode reads these to render Pause vs Resume and to suspend the
          // ETA heartbeat. Without them the pause is invisible to the cleaner.
          drivingPausedAt: true,
          drivingPauseReason: true,
          property: {
            select: {
              name: true,
              address: true,
              suburb: true,
              state: true,
              postcode: true,
              latitude: true,
              longitude: true,
            },
          },
        },
      },
    },
    orderBy: [{ job: { startTime: "asc" } }],
  });

  const stops = assignments.map((a) => ({
    jobId: a.job.id,
    jobNumber: a.job.jobNumber,
    jobType: a.job.jobType,
    status: a.job.status,
    startTime: a.job.startTime,
    dueTime: a.job.dueTime,
    estimatedHours: a.job.estimatedHours,
    timingBadges: resolveTimingBadges(a.job.internalNotes),
    sameDayCheckin: a.job.sameDayCheckin,
    sameDayCheckinTime: a.job.sameDayCheckinTime,
    enRouteStartedAt: a.job.enRouteStartedAt,
    enRouteEtaMinutes: a.job.enRouteEtaMinutes,
    arrivedAt: a.job.arrivedAt,
    drivingPausedAt: a.job.drivingPausedAt,
    drivingPauseReason: a.job.drivingPauseReason,
    propertyName: a.job.property.name,
    address: a.job.property.address,
    suburb: a.job.property.suburb,
    state: a.job.property.state,
    postcode: a.job.property.postcode,
    latitude: a.job.property.latitude,
    longitude: a.job.property.longitude,
  }));

  return NextResponse.json({ stops, date: bounds.date }, { headers: privateHeaders });
}
