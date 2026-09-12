import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { sydneyTodayKey, sydneyDayStart, sydneyDayEndInclusive } from "@/lib/time/sydney-range";
import { resolveTimingBadges, type JobTimingBadges } from "@/lib/jobs/timing-badges";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { RouteDriving } from "@/components/v2/cleaner/route-driving";

export const metadata = { title: "Route · Estate cleaner" };
export const dynamic = "force-dynamic";

interface Stop {
  jobId: string;
  jobNumber: number | string | null;
  jobType: string;
  status: string;
  startTime: string | null;
  dueTime: string | null;
  estimatedHours: number | null;
  timingBadges: JobTimingBadges | null;
  sameDayCheckin: boolean;
  sameDayCheckinTime: string | null;
  enRouteStartedAt: string | null;
  enRouteEtaMinutes: number | null;
  arrivedAt: string | null;
  /** Paused-drive state — Drive mode renders Resume from this, so it must be
   *  part of the server payload (it survives a page refresh). */
  drivingPausedAt: string | null;
  drivingPauseReason: string | null;
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
  const isoDate = sydneyTodayKey();
  const dayStart = sydneyDayStart(isoDate);
  const dayEnd = new Date(sydneyDayEndInclusive(isoDate).getTime() + 1);

  const assignments = await db.jobAssignment
    .findMany({
      where: {
        userId,
        removedAt: null,
        job: {
          scheduledDate: { gte: dayStart, lt: dayEnd },
          status: { notIn: ["COMPLETED", "INVOICED"] },
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

  const stops: Stop[] = assignments
    .filter((a) => a.job?.property)
    .map((a) => ({
      jobId: a.job!.id,
      jobNumber: a.job!.jobNumber as any,
      jobType: a.job!.jobType as unknown as string,
      status: a.job!.status as unknown as string,
      startTime: a.job!.startTime,
      dueTime: a.job!.dueTime,
      estimatedHours: a.job!.estimatedHours,
      timingBadges: resolveTimingBadges(a.job!.internalNotes),
      sameDayCheckin: a.job!.sameDayCheckin,
      sameDayCheckinTime: a.job!.sameDayCheckinTime,
      enRouteStartedAt: a.job!.enRouteStartedAt ? a.job!.enRouteStartedAt.toISOString() : null,
      enRouteEtaMinutes: a.job!.enRouteEtaMinutes,
      arrivedAt: a.job!.arrivedAt ? a.job!.arrivedAt.toISOString() : null,
      drivingPausedAt: a.job!.drivingPausedAt ? a.job!.drivingPausedAt.toISOString() : null,
      drivingPauseReason: a.job!.drivingPauseReason,
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

  let route;
  let preferredTransport;
  try {
    route = await loadTodayStops(session.user.id);
    const cleaner = await db.user.findUnique({
      where: { id: session.user.id }, select: { preferredTransport: true },
    });
    preferredTransport = cleaner?.preferredTransport ?? "DRIVING";
  } catch {
    return (
      <div role="alert" className="space-y-4">
        <p>Your route could not be loaded. Please try again.</p>
        <a href="/v2/cleaner/route" className="underline">Retry</a>
      </div>
    );
  }
  const { stops, isoDate } = route;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Today"
        title="Your route"
        description="Your live en-route surface with a GPS heartbeat, or the full timeline with navigation deep links."
      />
      <RouteDriving
        initialDate={isoDate}
        initialStops={stops}
        userId={session.user.id}
        preferredTransport={preferredTransport}
      />
    </div>
  );
}
