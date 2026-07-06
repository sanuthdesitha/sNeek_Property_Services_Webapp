import Link from "next/link";
import { format, isMatch } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { ExternalLink, MapPinned, Route } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Route map · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

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

type Tone = "neutral" | "success" | "warning";
function statusTone(status: string): Tone {
  if (status === "IN_PROGRESS") return "success";
  if (status === "PAUSED") return "warning";
  return "neutral";
}

export default async function V2RouteMapPage({
  searchParams,
}: {
  searchParams?: { date?: string | string[] };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const date = resolveDate(searchParams?.date);
  const todayDate = getDefaultDate();
  const tomorrowDate = getTomorrowDate();
  const routes = await buildDailyRoutePlan(date);
  const totalStops = routes.reduce((sum, route) => sum + route.stops.length, 0);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Cleaner route map"
        description="Daily route ordering, travel estimates, and one-click Google Maps links."
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
            <EButton type="submit" size="sm">Load routes</EButton>
            <EButton asChild size="sm" variant={date === todayDate ? "primary" : "outline"}>
              <Link href={`/v2/admin/jobs/route-map?date=${todayDate}`}>Today</Link>
            </EButton>
            <EButton asChild size="sm" variant={date === tomorrowDate ? "primary" : "outline"}>
              <Link href={`/v2/admin/jobs/route-map?date=${tomorrowDate}`}>Tomorrow</Link>
            </EButton>
            <EButton asChild size="sm" variant="outline">
              <Link href={`/v2/admin/ops/map?date=${date}`}>
                <MapPinned className="h-4 w-4" />
                Live ops map
              </Link>
            </EButton>
          </form>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <EStatCard label="Date" value={format(new Date(`${date}T00:00:00`), "dd MMM yyyy")} />
        <EStatCard label="Cleaner routes" value={routes.length} />
        <EStatCard label="Assigned stops" value={totalStops} />
      </div>

      {routes.length === 0 ? (
        <EEmptyState
          eyebrow="Route board"
          title="No routes for this date"
          description="No assigned cleaner routes were found. Assign cleaners to jobs on this date to build routes."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {routes.map((route) => {
          const addresses = route.stops.map((stop) => `${stop.address}, ${stop.suburb}`);
          const mapUrl = buildGoogleMapsMultiStopUrl(addresses);

          return (
            <ECard key={route.cleanerId}>
              <ECardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <ECardTitle className="text-[1rem]">{route.cleanerName}</ECardTitle>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {route.cleanerEmail} · {route.stops.length} stop{route.stops.length === 1 ? "" : "s"} · {route.totalEstimatedTravelMins} min estimated driving
                    </p>
                  </div>
                  {mapUrl ? (
                    <EButton asChild size="sm" variant="outline">
                      <a href={mapUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Open route
                      </a>
                    </EButton>
                  ) : null}
                </div>
              </ECardHeader>
              <ECardBody className="space-y-3 pt-0">
                {route.stops.map((stop, index) => {
                  const propertyMapUrl = buildGoogleMapsDirectionsUrl({ address: stop.address, suburb: stop.suburb, name: stop.propertyName });
                  return (
                    <div key={stop.jobId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[0.875rem] font-[550]">{index + 1}. {stop.propertyName}</p>
                            <EBadge tone={statusTone(stop.status)} soft>{stop.status.replace(/_/g, " ")}</EBadge>
                          </div>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{stop.address}, {stop.suburb}</p>
                          <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {stop.jobType.replace(/_/g, " ")}
                            {stop.startTime ? ` · ${stop.startTime}` : ""}
                            {stop.dueTime ? ` - ${stop.dueTime}` : ""}
                          </p>
                          <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                            {index > 0 ? `Approx. ${stop.estimatedTravelMinsFromPrev} min from previous stop` : "First stop of the run"}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 flex-wrap gap-2">
                          <EButton asChild size="sm" variant="ghost">
                            <Link href={`/admin/jobs/${stop.jobId}`}>Open job</Link>
                          </EButton>
                          {propertyMapUrl ? (
                            <EButton asChild size="sm" variant="outline">
                              <a href={propertyMapUrl} target="_blank" rel="noreferrer">
                                <MapPinned className="h-4 w-4" />
                                Maps
                              </a>
                            </EButton>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </ECardBody>
            </ECard>
          );
        })}
      </div>
    </div>
  );
}
