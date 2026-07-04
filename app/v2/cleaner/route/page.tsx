import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerRouteClient } from "@/components/cleaner/cleaner-route-client";

export const metadata = { title: "Route · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

interface Stop {
  jobId: string;
  jobNumber: number | string | null;
  jobType: string;
  status: string;
  startTime: string | null;
  dueTime: string | null;
  enRouteStartedAt: string | null;
  enRouteEtaMinutes: number | null;
  arrivedAt: string | null;
  propertyName: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Today's assigned stops for the session cleaner — identical query to the legacy
 * `app/cleaner/route` route (assignments scoped to the user, today's window,
 * open statuses). The mounted `CleanerRouteClient` owns the live travel-time
 * optimiser + en-route/arrived mutations via its own endpoints.
 */
async function loadTodayStops(userId: string): Promise<{ stops: Stop[]; isoDate: string }> {
  const zonedNow = toZonedTime(new Date(), TZ);
  const y = zonedNow.getFullYear();
  const m = String(zonedNow.getMonth() + 1).padStart(2, "0");
  const d = String(zonedNow.getDate()).padStart(2, "0");
  const isoDate = `${y}-${m}-${d}`;
  const dayStart = new Date(Date.UTC(y, zonedNow.getMonth(), zonedNow.getDate(), 0, 0, 0));
  const dayEnd = addDays(dayStart, 1);

  const assignments = await db.jobAssignment
    .findMany({
      where: {
        userId,
        removedAt: null,
        job: {
          scheduledDate: { gte: dayStart, lt: dayEnd },
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
    })
    .catch(() => []);

  const stops: Stop[] = assignments
    .filter((a) => a.job?.property)
    .map((a) => ({
      jobId: a.job!.id,
      jobNumber: a.job!.jobNumber as any,
      jobType: a.job!.jobType as unknown as string,
      status: a.job!.status as unknown as string,
      startTime: a.job!.startTime,
      dueTime: a.job!.dueTime,
      enRouteStartedAt: a.job!.enRouteStartedAt ? a.job!.enRouteStartedAt.toISOString() : null,
      enRouteEtaMinutes: a.job!.enRouteEtaMinutes,
      arrivedAt: a.job!.arrivedAt ? a.job!.arrivedAt.toISOString() : null,
      propertyName: a.job!.property!.name,
      address: a.job!.property!.address,
      suburb: a.job!.property!.suburb,
      state: a.job!.property!.state,
      postcode: a.job!.property!.postcode,
      latitude: a.job!.property!.latitude,
      longitude: a.job!.property!.longitude,
    }));

  return { stops, isoDate };
}

export default async function V2CleanerRoutePage() {
  let session;
  try {
    session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    redirect("/login?callbackUrl=/v2/cleaner/route");
  }

  const { stops, isoDate } = await loadTodayStops(session.user.id);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Today"
        title="Your route"
        description="Live travel times via Google Distance Matrix — driving, transit, walking, or biking."
      />
      <CleanerRouteClient initialDate={isoDate} initialStops={stops} />
    </div>
  );
}
