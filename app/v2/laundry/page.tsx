import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { LaundryStatus, Role } from "@prisma/client";
import { laundryTaskScope } from "@/lib/laundry/teams";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
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

async function getLaundry(scope: Awaited<ReturnType<typeof laundryTaskScope>>) {
  const today = sydneyTodayKey();
  const tomorrow = addDaysToKey(today, 1);
  // Scheduled dates are UTC date-only keys; delivery events are actual instants.
  // Keep these ranges distinct, especially across Sydney's 23/25-hour DST days.
  const scheduledStart = new Date(`${today}T00:00:00.000Z`);
  const scheduledEnd = new Date(`${tomorrow}T00:00:00.000Z`);
  const todayStart = sydneyDayStart(today);
  const todayEnd = sydneyDayStart(tomorrow);

  // Mirrors app/v2/admin/laundry/page.tsx getLaundry(await laundryTaskScope(session.user)).
  //
  // A set the laundry team already returned in the v1 portal is written as
  // status=DROPPED with a `droppedAt` timestamp (see the RETURNED→DROPPED map in
  // app/api/laundry/[taskId]/status/route.ts). Early returns — a first-class flow
  // here — leave the *scheduled* `dropoffDate` in the future, so filtering the
  // "today" board on `dropoffDate` alone dropped those sets entirely: v2 showed
  // them as un-returned (or missing) even though v1 marked them done. Match on the
  // canonical `droppedAt` as well so anything actually delivered today shows and
  // is counted as Delivered, regardless of its scheduled drop-off date.
  const tasks = await db.laundryTask
    .findMany({
      where: {
        ...scope,
        noPickupRequired: false,
        OR: [
          { pickupDate: { gte: scheduledStart, lt: scheduledEnd } },
          { dropoffDate: { gte: scheduledStart, lt: scheduledEnd } },
          { droppedAt: { gte: todayStart, lt: todayEnd } },
          { status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.READY_TO_RETURN, LaundryStatus.CONFIRMED] } },
        ],
      },
      orderBy: [{ pickupDate: "asc" }],
      select: {
        id: true,
        status: true,
        droppedAt: true,
        bagWeightKg: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => null);

  if (tasks === null) return { tasks: null, inQueue: null, inTransit: null, ready: null };

  const deliveredToday = (t: { status: LaundryStatus; droppedAt: Date | null }) =>
    t.status === LaundryStatus.DROPPED &&
    t.droppedAt != null &&
    t.droppedAt >= todayStart &&
    t.droppedAt < todayEnd;

  const inQueue = tasks.filter((t) => t.status === LaundryStatus.PENDING || t.status === LaundryStatus.CONFIRMED).length;
  const inTransit = tasks.filter((t) => t.status === LaundryStatus.PICKED_UP || t.status === LaundryStatus.READY_TO_RETURN).length;
  const ready = tasks.filter(deliveredToday).length;

  return { tasks, inQueue, inTransit, ready };
}

export default async function LaundryTodayPage() {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const laundry = getLaundry(await laundryTaskScope(session.user));
  // Null = could not be read (shown as such, never as "no requests").
  const officeRequests = await listOfficeRequestsForLaundryUser(session.user).catch(() => null);
  const [{ tasks, inQueue, inTransit, ready }, route] = await Promise.all([
    laundry,
    loadTodayRoute(session.user, officeRequests).catch(() => null),
  ]);
  const done = route?.stops.filter((stop) => stop.state === "done").length ?? 0;
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

      {/* 1. The route in order, with planned times and the next stop. */}
      <TodayRouteList route={route} />

      {session.user.role === Role.LAUNDRY ? <OfficeRequestsCard requests={officeRequests} /> : null}

      {/* 2. Today's figures (scoped to the properties this login serves). */}
      <section aria-label="Today's figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <EStatCard label="In queue" value={inQueue === null ? <span className="text-sm">Unavailable</span> : String(inQueue)} delta="pending" deltaTone="neutral" icon={<Waves className="h-4 w-4" />} />
        <EStatCard label="In transit" value={inTransit === null ? <span className="text-sm">Unavailable</span> : String(inTransit)} delta="picked up" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Delivered" value={ready === null ? <span className="text-sm">Unavailable</span> : String(ready)} delta="today" deltaTone={ready === null ? "neutral" : "success"} icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="In pipeline" value={tasks === null ? <span className="text-sm">Unavailable</span> : String(tasks.length)} delta="today and open work" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
      </section>

      {/* 3. Plan brief — counts, weather, traffic, special days, deadlines. */}
      <PlanBrief />

      {/* 4. Live queue — next 5 only; the full list lives on /v2/laundry/queue. */}
      <ECard>
        <ECardHeader>
          <div className="flex items-center justify-between gap-2">
            <ECardTitle>Live queue</ECardTitle>
            <Link href="/v2/laundry/queue" className="text-[0.8125rem] font-medium text-[hsl(var(--e-accent-portal))] hover:underline">View all →</Link>
          </div>
        </ECardHeader>
        <ECardBody className="space-y-1">
          {tasks === null ? (
            <div role="alert">
              <p>Laundry totals and live queue are unavailable.</p>
              <a href="/v2/laundry" className="underline">Retry laundry</a>
            </div>
          ) : tasks.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No laundry scheduled" description="Nothing in the laundry pipeline right now." />
          ) : (
            tasks.slice(0, 5).map((t, i) => (
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
function OfficeRequestsCard({ requests }: { requests: LaundryOfficeRequest[] | null }) {
  const open = requests?.filter((request) => request.state === "open") ?? [];
  return (
    <ECard id="office-requests">
      <ECardHeader>
        <div className="flex items-center justify-between gap-2">
          <ECardTitle>From the office</ECardTitle>
          {requests && requests.length ? <EBadge tone={open.length ? "warning" : "success"} soft>{open.length ? `${open.length} open` : "All answered"}</EBadge> : null}
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
          open.slice(0, 2).map((request) => (
            <p key={request.id} className="text-[0.8125rem]"><b className="font-[600]">{request.badge}</b> · {request.title} <span className="text-[hsl(var(--e-muted-foreground))]">({request.askedAtLabel})</span></p>
          ))
        )}
        {requests && requests.length ? (
          <Link href={LAUNDRY_REQUESTS_HREF} className="inline-flex min-h-11 items-center text-[0.875rem] font-medium text-[hsl(var(--e-accent-portal))] hover:underline">
            {open.length ? "Answer in From the office →" : "Open From the office →"}
          </Link>
        ) : null}
      </ECardBody>
    </ECard>
  );
}
