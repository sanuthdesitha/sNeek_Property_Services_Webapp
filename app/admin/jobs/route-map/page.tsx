import Link from "next/link";
import { format, isMatch } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { ExternalLink, MapPinned, Route } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import { CopyButton } from "@/components/shared/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

export default async function AdminRouteMapPage({
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cleaner Route Map</h1>
          <p className="text-sm text-muted-foreground">
            Daily route ordering, travel estimates, and one-click Google Maps links.
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
          <Button type="submit" size="sm">Load routes</Button>
          <Button asChild type="button" size="sm" variant={date === todayDate ? "default" : "outline"}>
            <Link href={`/admin/jobs/route-map?date=${todayDate}`}>Today</Link>
          </Button>
          <Button asChild type="button" size="sm" variant={date === tomorrowDate ? "default" : "outline"}>
            <Link href={`/admin/jobs/route-map?date=${tomorrowDate}`}>Tomorrow</Link>
          </Button>
          <Button asChild type="button" size="sm" variant="outline">
            <Link href={`/admin/ops/map?date=${date}`}>Live ops map</Link>
          </Button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{format(new Date(`${date}T00:00:00`), "dd MMM yyyy")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cleaner routes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{routes.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assigned stops</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStops}</div>
          </CardContent>
        </Card>
      </div>

      {routes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No assigned cleaner routes for this date.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {routes.map((route) => {
          const addresses = route.stops.map((stop) => `${stop.address}, ${stop.suburb}`);
          const mapUrl = buildGoogleMapsMultiStopUrl(addresses);

          return (
            <Card key={route.cleanerId}>
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>{route.cleanerName}</CardTitle>
                    <CardDescription>
                      {route.cleanerEmail}  -  {route.stops.length} stop{route.stops.length === 1 ? "" : "s"}  -  {route.totalEstimatedTravelMins} min estimated driving
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mapUrl ? (
                      <>
                        <Button asChild size="sm" variant="outline">
                          <a href={mapUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open route
                          </a>
                        </Button>
                        <CopyButton value={mapUrl} label="Copy route" />
                      </>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {route.stops.map((stop, index) => {
                  const propertyMapUrl = buildGoogleMapsDirectionsUrl({
                    address: stop.address,
                    suburb: stop.suburb,
                    name: stop.propertyName,
                  });
                  return (
                    <div key={stop.jobId} className="rounded-xl border px-3 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">{index + 1}. {stop.propertyName}</p>
                            <Badge variant={stop.status === "IN_PROGRESS" ? "default" : stop.status === "PAUSED" ? "warning" : "secondary"}>
                              {stop.status.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{stop.address}, {stop.suburb}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {stop.jobType.replace(/_/g, " ")}
                            {stop.startTime ? `  -  ${stop.startTime}` : ""}
                            {stop.dueTime ? ` - ${stop.dueTime}` : ""}
                          </p>
                          {index > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Approx. {stop.estimatedTravelMinsFromPrev} min from previous stop
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">First stop of the run</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/admin/jobs/${stop.jobId}`}>Open job</Link>
                          </Button>
                          {propertyMapUrl ? (
                            <Button asChild size="sm" variant="outline">
                              <a href={propertyMapUrl} target="_blank" rel="noreferrer">
                                <MapPinned className="mr-2 h-4 w-4" />
                                Maps
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
