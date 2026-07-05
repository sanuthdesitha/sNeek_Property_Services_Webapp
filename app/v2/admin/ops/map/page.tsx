import Link from "next/link";
import { addDays, format, isMatch } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus, Role } from "@prisma/client";
import { MapPin, Route, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EstateOpsMap, type OpsMapProperty } from "@/components/v2/admin/ops/estate-ops-map";
import { LiveCleaners } from "@/components/v2/admin/ops/live-cleaners";

export const metadata = { title: "Live map · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const ACTIVE_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.ASSIGNED,
  "EN_ROUTE" as JobStatus,
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
function getTomorrowDate() {
  const zoned = toZonedTime(new Date(), TZ);
  return format(new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate() + 1), "yyyy-MM-dd");
}
function resolveDate(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isMatch(candidate, "yyyy-MM-dd") ? candidate : getDefaultDate();
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
function statusTone(status: string): Tone {
  if (status === "IN_PROGRESS") return "success";
  if (status === "PAUSED") return "warning";
  return "neutral";
}

export default async function V2OpsMapPage({
  searchParams,
}: {
  searchParams?: { date?: string | string[] };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const date = resolveDate(searchParams?.date);
  const todayDate = getDefaultDate();
  const tomorrowDate = getTomorrowDate();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = addDays(start, 1);

  const [routes, jobs] = await Promise.all([
    buildDailyRoutePlan(date),
    db.job.findMany({
      where: { scheduledDate: { gte: start, lt: end }, status: { in: ACTIVE_STATUSES } },
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
        property: { select: { name: true, suburb: true, address: true, latitude: true, longitude: true } },
        assignments: { where: { removedAt: null }, select: { user: { select: { id: true, name: true, email: true } } } },
      },
    }),
  ]);

  const onSiteCount = jobs.filter((job) => typeof job.gpsDistanceMeters === "number" && job.gpsDistanceMeters < 500).length;
  const pendingSafetyCount = jobs.filter((job) => job.requiresSafetyCheckin && !job.safetyCheckinAt).length;

  const mapProperties: OpsMapProperty[] = jobs
    .filter((job) => job.property.latitude != null && job.property.longitude != null)
    .map((job) => ({
      jobId: job.id,
      name: job.property.name,
      suburb: job.property.suburb,
      lat: job.property.latitude as number,
      lng: job.property.longitude as number,
      status: job.status,
    }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Live operations map"
        description="Field-ready view of today's active jobs, GPS proximity, and safety check-in status."
        actions={
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="space-y-1 text-[0.75rem]">
              <span className="e-eyebrow block">Date</span>
              <input
                type="date"
                name="date"
                defaultValue={date}
                className="h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-foreground))]"
              />
            </label>
            <EButton type="submit" size="sm">Load view</EButton>
            <EButton asChild size="sm" variant={date === todayDate ? "primary" : "outline"}>
              <Link href={`/v2/admin/ops/map?date=${todayDate}`}>Today</Link>
            </EButton>
            <EButton asChild size="sm" variant={date === tomorrowDate ? "primary" : "outline"}>
              <Link href={`/v2/admin/ops/map?date=${tomorrowDate}`}>Tomorrow</Link>
            </EButton>
            <EButton asChild size="sm" variant="outline">
              <Link href={`/v2/admin/jobs/route-map?date=${date}`}>
                <Route className="h-4 w-4" />
                Route board
              </Link>
            </EButton>
          </form>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <EStatCard label="Active jobs" value={jobs.length} />
        <EStatCard label="GPS near property" value={onSiteCount} />
        <EStatCard label="Safety check-ins pending" value={pendingSafetyCount} deltaTone={pendingSafetyCount > 0 ? "danger" : "neutral"} />
      </div>

      <EstateOpsMap properties={mapProperties} />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Cleaner route links</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Open the day's multi-stop route per cleaner.</p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {routes.map((route) => {
              const routeUrl = buildGoogleMapsMultiStopUrl(route.stops.map((stop) => `${stop.address}, ${stop.suburb}`));
              return (
                <div key={route.cleanerId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[0.875rem] font-[550]">{route.cleanerName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {route.stops.length} stop{route.stops.length === 1 ? "" : "s"} · {route.totalEstimatedTravelMins} min estimated drive time
                      </p>
                    </div>
                    {routeUrl ? (
                      <EButton asChild size="sm" variant="outline">
                        <a href={routeUrl} target="_blank" rel="noreferrer">
                          <Route className="h-4 w-4" />
                          Open route
                        </a>
                      </EButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {routes.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No assigned routes for this date.</p>
            ) : null}
          </ECardBody>
        </ECard>

        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Safety & field status</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">GPS and safety-check highlights for active jobs.</p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {jobs.map((job) => {
              const mapUrl = buildGoogleMapsDirectionsUrl({ address: job.property.address, suburb: job.property.suburb, name: job.property.name });
              const cleanerNames = job.assignments.map((a) => a.user.name ?? a.user.email).join(", ");
              return (
                <div key={job.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[0.875rem] font-[550]">{job.property.name}</p>
                        <EBadge tone={statusTone(job.status)} soft>{job.status.replace(/_/g, " ")}</EBadge>
                        {job.requiresSafetyCheckin && !job.safetyCheckinAt ? <EBadge tone="danger" soft>Safety pending</EBadge> : null}
                        {job.safetyCheckinAt ? <EBadge tone="success" soft>Safety confirmed</EBadge> : null}
                      </div>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        #{job.jobNumber} · {job.jobType.replace(/_/g, " ")} · {job.property.address}, {job.property.suburb}
                      </p>
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {cleanerNames || "No cleaner assigned"}
                        {job.startTime ? ` · ${job.startTime}` : ""}
                        {job.dueTime ? ` - ${job.dueTime}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {typeof job.gpsDistanceMeters === "number" ? (
                          <EBadge tone={job.gpsDistanceMeters < 500 ? "success" : "warning"} soft>
                            {job.gpsDistanceMeters < 500 ? "On-site" : `${job.gpsDistanceMeters}m away`}
                          </EBadge>
                        ) : (
                          <EBadge tone="neutral">No GPS check-in yet</EBadge>
                        )}
                        {job.gpsCheckInAt ? <EBadge tone="neutral">GPS {format(new Date(job.gpsCheckInAt), "HH:mm")}</EBadge> : null}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap gap-2">
                      <EButton asChild size="sm" variant="ghost">
                        <Link href={`/admin/jobs/${job.id}`}>Open job</Link>
                      </EButton>
                      {mapUrl ? (
                        <EButton asChild size="sm" variant="outline">
                          <a href={mapUrl} target="_blank" rel="noreferrer">
                            <MapPin className="h-4 w-4" />
                            Maps
                          </a>
                        </EButton>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {jobs.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active jobs for this date.</p>
            ) : null}
          </ECardBody>
        </ECard>
      </div>

      <ECard>
        <ECardHeader>
          <ECardTitle className="text-[1rem]">Priority checks</ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Fast links for dispatch and field-safety follow-up.</p>
        </ECardHeader>
        <ECardBody className="flex flex-wrap gap-2 pt-0">
          <EButton asChild size="sm" variant="outline">
            <Link href="/v2/admin/jobs?status=UNASSIGNED">Unassigned jobs</Link>
          </EButton>
          <EButton asChild size="sm" variant="outline">
            <Link href="/v2/admin/jobs?status=WAITING_CONTINUATION_APPROVAL">Continuation approvals</Link>
          </EButton>
          <EButton asChild size="sm" variant="outline">
            <Link href="/admin/cases">
              <ShieldAlert className="h-4 w-4" />
              Open cases
            </Link>
          </EButton>
        </ECardBody>
      </ECard>

      <LiveCleaners mapDate={date} />
    </div>
  );
}
