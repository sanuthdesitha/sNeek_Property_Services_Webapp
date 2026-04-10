import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";

const TZ = "Australia/Sydney";

function resolveDateBounds(inputDate: string | null) {
  const zonedNow = toZonedTime(new Date(), TZ);
  const todayIso = `${zonedNow.getFullYear()}-${String(zonedNow.getMonth() + 1).padStart(2, "0")}-${String(zonedNow.getDate()).padStart(2, "0")}`;
  const target = inputDate && /^\d{4}-\d{2}-\d{2}$/.test(inputDate) ? inputDate : todayIso;
  const [year, month, day] = target.split("-").map((value) => Number(value));
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return {
    date: target,
    start: dayStart,
    end: addDays(dayStart, 1),
  };
}

export async function GET(req: Request) {
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  const { searchParams } = new URL(req.url);
  const relative = (searchParams.get("relative") || "").toLowerCase();
  const explicitDate = searchParams.get("date");

  const zonedNow = toZonedTime(new Date(), TZ);
  const tomorrow = addDays(new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate()), 1);
  const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const targetDate = relative === "tomorrow" ? tomorrowIso : explicitDate;
  const bounds = resolveDateBounds(targetDate);

  const assignments = await db.jobAssignment.findMany({
    where: {
      userId: session.user.id,
      removedAt: null,
      job: {
        scheduledDate: { gte: bounds.start, lt: bounds.end },
        status: { notIn: ["COMPLETED", "INVOICED"] },
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
          enRouteStartedAt: true,
          enRouteEtaMinutes: true,
          arrivedAt: true,
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
    enRouteStartedAt: a.job.enRouteStartedAt,
    enRouteEtaMinutes: a.job.enRouteEtaMinutes,
    arrivedAt: a.job.arrivedAt,
    propertyName: a.job.property.name,
    address: a.job.property.address,
    suburb: a.job.property.suburb,
    state: a.job.property.state,
    postcode: a.job.property.postcode,
    latitude: a.job.property.latitude,
    longitude: a.job.property.longitude,
  }));

  return NextResponse.json({ stops, date: bounds.date });
}
