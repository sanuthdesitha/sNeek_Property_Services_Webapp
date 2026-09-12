import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EBadge,
  EButton,
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
import { LaundryRouteMap } from "@/components/v2/laundry/route-map";
import { PlanBrief } from "@/components/v2/laundry/plan-brief";
import { sydneyDayKey } from "@/lib/laundry/route-candidates";
import { nextIncompleteStop, parseRouteStops } from "@/lib/laundry/route-plan";
import { ArrowRight, Navigation, PackageCheck, Route as RouteIcon, Timer, Truck, Waves } from "lucide-react";

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

async function getLaundry() {
  const today = sydneyTodayKey();
  const tomorrow = addDaysToKey(today, 1);
  // Scheduled dates are UTC date-only keys; delivery events are actual instants.
  // Keep these ranges distinct, especially across Sydney's 23/25-hour DST days.
  const scheduledStart = new Date(`${today}T00:00:00.000Z`);
  const scheduledEnd = new Date(`${tomorrow}T00:00:00.000Z`);
  const todayStart = sydneyDayStart(today);
  const todayEnd = sydneyDayStart(tomorrow);

  // Mirrors app/v2/admin/laundry/page.tsx getLaundry().
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
        noPickupRequired: false,
        OR: [
          { pickupDate: { gte: scheduledStart, lt: scheduledEnd } },
          { dropoffDate: { gte: scheduledStart, lt: scheduledEnd } },
          { droppedAt: { gte: todayStart, lt: todayEnd } },
          { status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.CONFIRMED] } },
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
  const inTransit = tasks.filter((t) => t.status === LaundryStatus.PICKED_UP).length;
  const ready = tasks.filter(deliveredToday).length;

  return { tasks, inQueue, inTransit, ready };
}

/**
 * Today's route card data for the signed-in driver: an ACTIVE route ("Stop 3
 * of 8 · next: …" + Continue) or a Build-today's-route CTA.
 */
async function getRouteCard(userId: string) {
  const todayKey = sydneyDayKey(new Date());
  const routes = await db.laundryRoute
    .findMany({ where: { userId, date: todayKey, status: { in: ["ACTIVE", "DRAFT"] } } });
  const route =
    routes.find((r) => r.status === "ACTIVE") ??
    routes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
    null;
  if (!route || route.status !== "ACTIVE") {
    return { active: false as const, hasDraft: route?.status === "DRAFT" };
  }

  const stops = parseRouteStops(route.stops);
  const next = nextIncompleteStop(stops);
  const doneCount = stops.filter((s) => s.completedAt).length;
  let nextLabel: string | null = null;
  let nextPropertyUnavailable = false;
  if (next) {
    const property = await db.property
      .findUnique({ where: { id: next.propertyId }, select: { name: true } })
      .catch(() => undefined);
    nextPropertyUnavailable = property === undefined;
    nextLabel = `${nextPropertyUnavailable ? "Property unavailable" : property?.name ?? "Unknown property"} ${next.kind === "PICKUP" ? "pickup" : "drop-off"}`;
  }
  return {
    active: true as const,
    stopNumber: Math.min(doneCount + 1, stops.length),
    stopCount: stops.length,
    nextLabel,
    nextPropertyUnavailable,
  };
}

export default async function LaundryTodayPage() {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const [{ tasks, inQueue, inTransit, ready }, routeCard] = await Promise.all([
    getLaundry(),
    getRouteCard(session.user.id).catch(() => null),
  ]);

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>LAUNDRY OPERATIONS · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s linen.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      {/* 1. Route card — continue the live run, or build one. */}
      <ECard>
        <ECardBody className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
              {routeCard?.active ? <Navigation className="h-4 w-4" /> : <RouteIcon className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              {routeCard === null ? (
                <p role="alert">Today&apos;s route is unavailable.</p>
              ) : routeCard.active ? (
                <>
                  <p className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                    Route in progress — stop {routeCard.stopNumber} of {routeCard.stopCount}
                  </p>
                  <p className="truncate text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {routeCard.nextLabel ? `Next: ${routeCard.nextLabel}` : "All stops complete — end the route."}
                  </p>
                  {routeCard.nextPropertyUnavailable ? (
                    <p role="alert">The next property&apos;s details could not be loaded. <a href="/v2/laundry" className="underline">Retry property details</a></p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                    {routeCard.hasDraft ? "Your route draft is waiting" : "Build today's route"}
                  </p>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    Pick today&apos;s, tomorrow&apos;s and overdue stops, order the run, go.
                  </p>
                </>
              )}
            </div>
          </div>
          <EButton asChild>
            {routeCard === null ? (
              <a href="/v2/laundry">Retry route <ArrowRight className="h-4 w-4" /></a>
            ) : (
              <Link href="/v2/laundry/route">
                {routeCard.active ? "Continue route" : routeCard.hasDraft ? "Resume draft" : "Build route"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </EButton>
        </ECardBody>
      </ECard>

      {/* 2. Plan brief — counts, weather, traffic, special days, deadlines. */}
      <PlanBrief />

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="In queue" value={inQueue === null ? <span className="text-sm">Unavailable</span> : String(inQueue)} delta="pending" deltaTone="neutral" icon={<Waves className="h-4 w-4" />} />
        <EStatCard label="In transit" value={inTransit === null ? <span className="text-sm">Unavailable</span> : String(inTransit)} delta="picked up" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Delivered" value={ready === null ? <span className="text-sm">Unavailable</span> : String(ready)} delta="today" deltaTone={ready === null ? "neutral" : "success"} icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="In pipeline" value={tasks === null ? <span className="text-sm">Unavailable</span> : String(tasks.length)} delta="today and open work" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
      </section>

      {/* 3. Live queue — next 5 only; the full list lives on /v2/laundry/queue. */}
      <ECard>
        <ECardHeader>
          <div className="flex items-center justify-between gap-2">
            <ECardTitle>Live queue</ECardTitle>
            <Link
              href="/v2/laundry/queue"
              className="text-[0.8125rem] font-medium text-[hsl(var(--e-accent-portal))] hover:underline"
            >
              View all →
            </Link>
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
            tasks.slice(0, 5).map((t, i) => {
              const name = t.property?.name ?? "Property";
              const suburb = t.property?.suburb ?? "";
              return (
                <div key={t.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium">{name}{suburb ? `, ${suburb}` : ""}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {t.bagWeightKg ? `${t.bagWeightKg} kg` : "Weight t.b.c."}
                      </p>
                    </div>
                    <EBadge tone={statusTone(t.status)} soft>{statusLabel(t.status)}</EBadge>
                  </div>
                </div>
              );
            })
          )}
        </ECardBody>
      </ECard>

      <LaundryRouteMap />
    </div>
  );
}
