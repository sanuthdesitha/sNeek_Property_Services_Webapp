import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";

const TZ = "Australia/Sydney";

export async function GET() {
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);

  const zonedNow = toZonedTime(new Date(), TZ);
  const todayStart = new Date(Date.UTC(
    zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate(), 0, 0, 0
  ));
  const tomorrowStart = addDays(todayStart, 1);

  const assignments = await db.jobAssignment.findMany({
    where: {
      userId: session.user.id,
      removedAt: null,
      job: {
        scheduledDate: { gte: todayStart, lt: tomorrowStart },
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

  return NextResponse.json({ stops });
}
