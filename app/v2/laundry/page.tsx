import { LaundryStatus, Role } from "@prisma/client";
import { laundryTaskScope } from "@/lib/laundry/teams";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { LaundryRouteMap } from "@/components/v2/laundry/route-map";
import { PlanBrief } from "@/components/v2/laundry/plan-brief";
import { TodayRouteList } from "@/components/v2/laundry/portal/today-route-list";
import { listOfficeRequestsForLaundryUser, OFFICE_REQUEST_WINDOW_HOURS, type LaundryOfficeRequest } from "@/lib/laundry/office-requests";
import { LAUNDRY_REQUESTS_HREF } from "@/lib/laundry/office-request-types";
import { loadTodayRoute } from "@/lib/laundry/today-route";
import { loadTodayRuns, type TodayRuns } from "@/lib/laundry/today-runs";
import { PackageCheck, Timer, Truck, Waves } from "lucide-react";

export const metadata = { title: "Today · Estate laundry" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function statusTone(status: LaundryStatus): Tone {
  switch (status) {
    case LaundryStatus.PENDING:
      return "neutral";
    case LaundryStatus.CONFIRMED:
      return "primary";
    case LaundryStatus.PICKED_UP:
      return "info";
    case LaundryStatus.READY_TO_RETURN:
      return "info";
    case LaundryStatus.DROPPED:
      return "success";
    case LaundryStatus.FLAGGED:
      return "danger";
    case LaundryStatus.SKIPPED_PICKUP:
      return "warning";
    default:
      return "neutral";
  }
}

function statusLabel(status: LaundryStatus): string {
  switch (status) {
    case LaundryStatus.PENDING:
      return "Pending";
    case LaundryStatus.CONFIRMED:
      return "Confirmed";
    case LaundryStatus.PICKED_UP:
      return "Picked up";
    case LaundryStatus.READY_TO_RETURN:
      return "Ready to return";
    case LaundryStatus.DROPPED:
      return "Delivered";
    case LaundryStatus.FLAGGED:
      return "Flagged";
    case LaundryStatus.SKIPPED_PICKUP:
      return "Skipped";
    default:
      return status;
  }
}

type TodayFigures = { inQueue: number; inTransit: number; delivered: number; total: number };

/** Today's figures from today's runs only (the Runs rule; owner decision 2026-11-13). */
function todayFigures(runs: TodayRuns): TodayFigures {
  return {
    inQueue: runs.pickups.filter((t) => t.status === LaundryStatus.PENDING || t.status === LaundryStatus.CONFIRMED).length,
    inTransit: runs.dropoffs.filter((t) => t.status === LaundryStatus.PICKED_UP || t.status === LaundryStatus.READY_TO_RETURN).length,
    delivered: runs.dropoffs.filter((t) => t.status === LaundryStatus.DROPPED).length,
    total: runs.tasks.length,
  };
}

function figure(value: number | undefined) {
  return value === undefined ? <span className="text-sm">Unavailable</span> : String(value);
}

/**
 * Today (owner decision 2026-11-13: "only show what is scheduled today, as in
 * the Runs page"). Every section reads today's runs from the SAME query and
 * rule as the Runs board (lib/laundry/today-runs.ts): the route list, the
 * figures, "Today's runs" and the office requests about those runs. A failed
 * or flagged run from another day is not shown here; it stays on Runs
 * (another range), Tracking, Queue and History. A run scheduled today that
 * failed today shows, marked Flagged.
 */
export default async function LaundryTodayPage() {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const scope = await laundryTaskScope(session.user);
  // Null = could not be read (shown as such, never as "no requests" or "no runs").
  const [officeRequests, runs] = await Promise.all([
    listOfficeRequestsForLaundryUser(session.user).catch(() => null),
    loadTodayRuns(session.user, scope).catch(() => null),
  ]);
  const route = runs
    ? await loadTodayRoute(session.user, officeRequests, { pickupIds: new Set(runs.pickups.map((t) => t.id)), dropIds: new Set(runs.dropoffs.map((t) => t.id)) }).catch(() => null)
    : null;
  const figures = runs ? todayFigures(runs) : null;
  const current = route?.stops.find((stop) => stop.state === "now");
  const routeLine = route === null
    ? "Route unavailable"
    : route.mode === "active"
      ? `Route started ${route.startedAtLabel ?? "today"} · ${current ? `stop ${current.number} of ${route.stops.length}` : `all ${route.stops.length} stops done`}`
      : route.mode === "draft" ? `Draft route · ${route.stops.length} stops, not started` : `No route yet · ${route.stops.length} stop${route.stops.length === 1 ? "" : "s"} today`;

  return (
    <div className="space-y-6">
      <header className="e-rise">
        <EEyebrow>{formatInTimeZone(new Date(), "Australia/Sydney", "EEEE · d MMMM")}</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s linen.</h1>
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{routeLine}</p>
        <div className="e-signature-rule mt-4" />
      </header>

      {/* 1. The route in order, with planned times and the next stop (today's runs only). */}
      <TodayRouteList route={route} />

      {session.user.role === Role.LAUNDRY ? <OfficeRequestsCard requests={officeRequests} todayTaskIds={runs?.taskIds ?? null} /> : null}

      {/* 2. Today's figures (today's runs, scoped to the properties this login serves). */}
      <section aria-label="Today's figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <EStatCard label="In queue" value={figure(figures?.inQueue)} delta="to collect today" deltaTone="neutral" icon={<Waves className="h-4 w-4" />} />
        <EStatCard label="In transit" value={figure(figures?.inTransit)} delta="due back today" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Delivered" value={figure(figures?.delivered)} delta="today" deltaTone={figures ? "success" : "neutral"} icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="Runs today" value={figure(figures?.total)} delta="pickups and drop-offs" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
      </section>

      {/* 3. Plan brief — counts, weather, traffic, special days, deadlines. */}
      <PlanBrief />

      {/* 4. Today's runs — next 5; the loops live on Runs, every set by stage on Queue. */}
      <ECard>
        <ECardHeader>
          <div className="flex items-center justify-between gap-2">
            <ECardTitle>Today&apos;s runs</ECardTitle>
            <Link href="/v2/laundry/runs" className="text-[0.8125rem] font-medium text-[hsl(var(--e-accent-portal))] hover:underline">View all →</Link>
          </div>
        </ECardHeader>
        <ECardBody className="space-y-1">
          {runs === null ? (
            <div role="alert">
              <p>Today&apos;s runs are unavailable.</p>
              <a href="/v2/laundry" className="underline">Retry laundry</a>
            </div>
          ) : runs.tasks.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No runs today" description="No pickups or drop-offs are scheduled for today." />
          ) : (
            runs.tasks.slice(0, 5).map((t, i) => (
              <div key={t.id}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[0.875rem] font-medium">{t.property?.name ?? "Property"}{t.property?.suburb ? `, ${t.property.suburb}` : ""}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{t.bagWeightKg ? `${t.bagWeightKg} kg` : "Weight t.b.c."}</p>
                  </div>
                  <EBadge tone={statusTone(t.status)} soft>{statusLabel(t.status)}</EBadge>
                </div>
              </div>
            ))
          )}
          <p className="pt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Runs from other days (failed, flagged or overdue) are in <Link href="/v2/laundry/tracking" className="underline">Tracking</Link> and <Link href="/v2/laundry/queue" className="underline">Queue</Link>.
          </p>
        </ECardBody>
      </ECard>

      {/* 5. Map, live route runner (GPS while a route is active) and route sharing. */}
      <LaundryRouteMap />
    </div>
  );
}

/**
 * "From the office" on Today: how many requests are still open, the first
 * two, and the way into the inbox where each is answered.
 */
function OfficeRequestsCard({ requests, todayTaskIds }: { requests: LaundryOfficeRequest[] | null; todayTaskIds: ReadonlySet<string> | null }) {
  // Only the open requests about today's runs (owner decision 2026-11-13); the
  // header's "From the office" icon keeps the full count, and the inbox lists all.
  const allOpen = requests?.filter((request) => request.state === "open") ?? [];
  const open = todayTaskIds ? allOpen.filter((request) => todayTaskIds.has(request.taskId)) : allOpen;
  const otherDays = allOpen.length - open.length;
  return (
    <ECard id="office-requests">
      <ECardHeader>
        <div className="flex items-center justify-between gap-2">
          <ECardTitle>From the office</ECardTitle>
          {requests && requests.length ? <EBadge tone={open.length ? "warning" : "success"} soft>{open.length ? `${open.length} open today` : allOpen.length ? "None today" : "All answered"}</EBadge> : null}
        </div>
      </ECardHeader>
      <ECardBody className="space-y-2">
        {requests === null ? (
          <div role="alert">
            <p>Requests from the office could not be loaded.</p>
            <a href="/v2/laundry" className="underline">Retry</a>
          </div>
        ) : requests.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No requests in the last {OFFICE_REQUEST_WINDOW_HOURS / 24} days.</p>
        ) : (
          <>
            {open.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No open requests about today&apos;s runs.</p> : null}
            {open.slice(0, 2).map((request) => (
              <p key={request.id} className="text-[0.8125rem]"><b className="font-[600]">{request.badge}</b> · {request.title} <span className="text-[hsl(var(--e-muted-foreground))]">({request.askedAtLabel})</span></p>
            ))}
            {otherDays > 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{otherDays} more open about other days.</p> : null}
          </>
        )}
        {requests && requests.length ? (
          <Link href={LAUNDRY_REQUESTS_HREF} className="inline-flex min-h-11 items-center text-[0.875rem] font-medium text-[hsl(var(--e-accent-portal))] hover:underline">
            {allOpen.length ? "Answer in From the office →" : "Open From the office →"}
          </Link>
        ) : null}
      </ECardBody>
    </ECard>
  );
}
