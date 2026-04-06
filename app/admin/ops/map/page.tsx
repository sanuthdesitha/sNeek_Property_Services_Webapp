import Link from "next/link";
import { addDays, format, isMatch } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus, Role } from "@prisma/client";
import { ExternalLink, MapPin, Route, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import { CopyButton } from "@/components/shared/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TZ = "Australia/Sydney";
const ACTIVE_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.ASSIGNED,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

function getDefaultDate() {
  const zoned = toZonedTime(new Date(), TZ);
  return format(new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()), "yyyy-MM-dd");
}

function resolveDate(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isMatch(candidate, "yyyy-MM-dd") ? candidate : getDefaultDate();
}

export default async function OpsMapPage({
  searchParams,
}: {
  searchParams?: { date?: string | string[] };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const date = resolveDate(searchParams?.date);
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = addDays(start, 1);

  const [routes, jobs] = await Promise.all([
    buildDailyRoutePlan(date),
    db.job.findMany({
      where: {
        scheduledDate: { gte: start, lt: end },
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: [{ startTime: "asc" }, { dueTime: "asc" }, { priorityBucket: "asc" }],
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        startTime: true,
        dueTime: true,
        priorityBucket: true,
        gpsCheckInAt: true,
        gpsDistanceMeters: true,
        requiresSafetyCheckin: true,
        safetyCheckinAt: true,
        property: {
          select: {
            name: true,
            suburb: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
  ]);

  const onSiteCount = jobs.filter((job) => typeof job.gpsDistanceMeters === "number" && job.gpsDistanceMeters < 500).length;
  const pendingSafetyCount = jobs.filter((job) => job.requiresSafetyCheckin && !job.safetyCheckinAt).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Operations Map</h1>
          <p className="text-sm text-muted-foreground">
            Field-ready view of today&apos;s active jobs, GPS proximity, and safety check-in status.
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Date</span>
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <Button type="submit" size="sm">Load view</Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/jobs/route-map?date=${date}`}>Route board</Link>
          </Button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">GPS near property</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{onSiteCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Safety check-ins pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingSafetyCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Cleaner route links</CardTitle>
            <CardDescription>Open the day&apos;s multi-stop route per cleaner.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {routes.map((route) => {
              const routeUrl = buildGoogleMapsMultiStopUrl(route.stops.map((stop) => `${stop.address}, ${stop.suburb}`));
              return (
                <div key={route.cleanerId} className="rounded-xl border px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">{route.cleanerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {route.stops.length} stop{route.stops.length === 1 ? "" : "s"}  -  {route.totalEstimatedTravelMins} min estimated drive time
                      </p>
                    </div>
                    {routeUrl ? (
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <a href={routeUrl} target="_blank" rel="noreferrer">
                            <Route className="mr-2 h-4 w-4" />
                            Open route
                          </a>
                        </Button>
                        <CopyButton value={routeUrl} label="Copy" />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {routes.length === 0 ? <p className="text-sm text-muted-foreground">No assigned routes for this date.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Safety and field status</CardTitle>
            <CardDescription>GPS and safety-check highlights for active jobs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobs.map((job) => {
              const mapUrl = buildGoogleMapsDirectionsUrl({
                address: job.property.address,
                suburb: job.property.suburb,
                name: job.property.name,
              });
              const cleanerNames = job.assignments.map((assignment) => assignment.user.name ?? assignment.user.email).join(", ");
              return (
                <div key={job.id} className="rounded-xl border px-3 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{job.property.name}</p>
                        <Badge variant={job.status === "IN_PROGRESS" ? "default" : job.status === "PAUSED" ? "warning" : "secondary"}>
                          {job.status.replace(/_/g, " ")}
                        </Badge>
                        {job.requiresSafetyCheckin && !job.safetyCheckinAt ? (
                          <Badge variant="destructive">Safety pending</Badge>
                        ) : null}
                        {job.safetyCheckinAt ? <Badge variant="secondary">Safety confirmed</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        #{job.jobNumber}  -  {job.jobType.replace(/_/g, " ")}  -  {job.property.address}, {job.property.suburb}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cleanerNames || "No cleaner assigned"}
                        {job.startTime ? `  -  ${job.startTime}` : ""}
                        {job.dueTime ? ` - ${job.dueTime}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {typeof job.gpsDistanceMeters === "number" ? (
                          <Badge variant={job.gpsDistanceMeters < 500 ? "secondary" : "warning"}>
                            {job.gpsDistanceMeters < 500 ? "On-site" : `${job.gpsDistanceMeters}m away`}
                          </Badge>
                        ) : (
                          <Badge variant="outline">No GPS check-in yet</Badge>
                        )}
                        {job.gpsCheckInAt ? (
                          <Badge variant="outline">GPS {format(new Date(job.gpsCheckInAt), "HH:mm")}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/jobs/${job.id}`}>Open job</Link>
                      </Button>
                      {mapUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={mapUrl} target="_blank" rel="noreferrer">
                            <MapPin className="mr-2 h-4 w-4" />
                            Maps
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No active jobs for this date.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Priority checks</CardTitle>
          <CardDescription>Fast links for dispatch and field safety follow-up.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/jobs?status=UNASSIGNED">Unassigned jobs</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/jobs?status=WAITING_CONTINUATION_APPROVAL">Continuation approvals</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/cases">
              <ShieldAlert className="mr-2 h-4 w-4" />
              Open cases
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
