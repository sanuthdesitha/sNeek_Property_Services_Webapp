import Link from "next/link";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { MaintenanceStatus, MaintenancePriority, MaintenanceAction, Role, type Prisma } from "@prisma/client";
import { maintenanceItemScope } from "@/lib/maintenance/item-scope";
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
import { formatInTimeZone } from "date-fns-tz";
import { ChevronRight } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { listMaintenanceItemsForUser } from "@/lib/maintenance/assignments";
import { MAINTENANCE_STAGES } from "@/lib/maintenance/ticket-stage";
import { NewAssignments, isNewAssignment, type NewAssignmentEntry } from "@/components/v2/maintenance/today/new-assignments";

const TZ = "Australia/Sydney";

export const metadata = { title: "Today · Estate maintenance" };
export const dynamic = "force-dynamic";

const OPEN_STATUSES = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.ACKNOWLEDGED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.ORDERED,
];

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function priorityTone(p: MaintenancePriority): Tone {
  switch (p) {
    case MaintenancePriority.URGENT:
      return "danger";
    case MaintenancePriority.HIGH:
      return "warning";
    case MaintenancePriority.MEDIUM:
      return "info";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type DueItem = {
  id: string;
  title: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  scheduledFor: Date | null;
  property: { name: string | null; suburb: string | null } | null;
};

type OpenItem = {
  id: string;
  title: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  property: { name: string | null; suburb: string | null } | null;
};

async function getMaintenance(scope: Prisma.PropertyMaintenanceItemWhereInput) {
  const today = sydneyTodayKey();
  const todayStart = sydneyDayStart(today);
  const todayEnd = sydneyDayStart(addDaysToKey(today, 1));
  const weekStart = sydneyDayStart(addDaysToKey(today, -6));

  const [openItems, openCount, dueToday, replacements, closedWeek, dueItems, replacementItems] = await Promise.all([
    db.propertyMaintenanceItem
      .findMany({
        where: { ...scope, status: { in: OPEN_STATUSES } },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 20,
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          property: { select: { name: true, suburb: true } },
        },
      })
      .catch(() => null),
    db.propertyMaintenanceItem.count({ where: { ...scope, status: { in: OPEN_STATUSES } } }).catch(() => null),
    db.propertyMaintenanceItem
      .count({ where: { ...scope, status: { in: OPEN_STATUSES }, scheduledFor: { gte: todayStart, lt: todayEnd } } })
      .catch(() => null),
    db.propertyMaintenanceItem
      .count({
        where: {
          ...scope,
          status: { in: OPEN_STATUSES },
          recommendedAction: { in: [MaintenanceAction.REPLACE, MaintenanceAction.RESTOCK] },
        },
      })
      .catch(() => null),
    db.propertyMaintenanceItem
      .count({ where: { ...scope, status: MaintenanceStatus.RESOLVED, resolvedAt: { gte: weekStart } } })
      .catch(() => null),
    // Board: "Due today" in visit order, with time, stage and priority.
    db.propertyMaintenanceItem
      .findMany({
        where: { ...scope, status: { in: OPEN_STATUSES }, scheduledFor: { gte: todayStart, lt: todayEnd } },
        orderBy: [{ scheduledFor: "asc" }, { priority: "desc" }],
        take: 20,
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          scheduledFor: true,
          property: { select: { name: true, suburb: true } },
        },
      })
      .then((rows) => rows as DueItem[])
      .catch(() => null),
    // Board: "Replacements to order", a one-line preview of the first few.
    db.propertyMaintenanceItem
      .findMany({
        where: {
          ...scope,
          status: { in: OPEN_STATUSES },
          recommendedAction: { in: [MaintenanceAction.REPLACE, MaintenanceAction.RESTOCK] },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 3,
        select: { id: true, title: true, property: { select: { name: true } } },
      })
      .catch(() => null),
  ]);

  return { openItems, openCount, dueToday, replacements, closedWeek, dueItems, replacementItems };
}

/** Offered assignments not yet answered. A failed read is null, never "none". */
async function getNewAssignments(userId: string | undefined): Promise<NewAssignmentEntry[] | null> {
  if (!userId) return [];
  try {
    const entries = await listMaintenanceItemsForUser(userId, { scope: "active" });
    return entries.filter(isNewAssignment);
  } catch {
    return null;
  }
}

/** "Coogee Terrace · High · Acknowledged"; unknown values are left out, not guessed. */
function dueLine(item: DueItem): string {
  const stage = item.status ? MAINTENANCE_STAGES[item.status as keyof typeof MAINTENANCE_STAGES] ?? titleCase(item.status) : null;
  return [item.property?.name ?? "Property", item.priority ? titleCase(item.priority) : null, stage].filter(Boolean).join(" · ");
}

function hhmm(value: Date | null): string | null {
  return value ? formatInTimeZone(value, TZ, "HH:mm") : null;
}

export default async function MaintenanceTodayPage() {
  const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const [{ openItems, openCount, dueToday, replacements, closedWeek, dueItems, replacementItems }, newAssignments] = await Promise.all([
    getMaintenance(maintenanceItemScope(session.user)),
    getNewAssignments(session.user.id),
  ]);
  const unavailable = [openItems, openCount, dueToday, replacements, closedWeek, dueItems, newAssignments].some((value) => value === null);
  const countLabel = (value: number | null) => value === null ? <span className="text-sm">Unavailable</span> : String(value);
  const dayLabel = formatInTimeZone(new Date(), TZ, "EEEE · d MMMM");
  const openNext = dueItems?.[0] ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="e-rise">
        <EEyebrow>{dayLabel}</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s work orders.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      {unavailable ? <div role="alert" className={`rounded-[var(--e-radius)] ${toneNoticeClass("problem")} px-4 py-3 text-sm`}>
        Some maintenance data could not be loaded. <a href="/v2/maintenance" className="underline">Retry</a>
      </div> : null}
      <section aria-label="Today's figures" className="grid grid-cols-3 gap-2 sm:gap-4">
        <EStatCard label="Open" value={countLabel(openCount)} delta="active" deltaTone="neutral" />
        <EStatCard label="Due today" value={countLabel(dueToday)} delta="scheduled" deltaTone="neutral" />
        <EStatCard label="Closed · week" value={countLabel(closedWeek)} delta="resolved" />
      </section>

      {newAssignments ? <NewAssignments entries={newAssignments} /> : null}

      <section aria-labelledby="maintenance-due" className="space-y-2">
        <h2 id="maintenance-due" className="e-eyebrow">Due today</h2>
        {dueItems === null ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Today&apos;s schedule is unavailable.</p>
        ) : dueItems.length === 0 ? (
          <p className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Nothing scheduled for today.
          </p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            {dueItems.map((item) => (
              <li key={item.id}>
                <Link href={`/v2/maintenance/visits/${item.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2">
                  <span className="e-tnum w-12 shrink-0 text-[0.875rem] font-[600]">{hhmm(item.scheduledFor) ?? "—"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-[600]">{item.title}</span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {dueLine(item)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ECard>
        <ECardBody className="p-0">
          <Link href="/v2/maintenance/replacements" className="flex min-h-12 items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[0.875rem] font-[600]">
                Replacements to order {replacements !== null ? <EBadge tone="warning" soft>{replacements}</EBadge> : null}
              </span>
              <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {replacements === null
                  ? "Count unavailable"
                  : replacementItems && replacementItems.length > 0
                    ? replacementItems.map((item) => [item.title, item.property?.name].filter(Boolean).join(", ")).join(" · ")
                    : "Nothing to order"}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader><ECardTitle>All open tickets</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {openItems === null ? <p role="status">Open tickets are unavailable.</p> : openItems.length === 0 ? (
            <EEmptyState eyebrow="All clear" title="No open tickets" description="Nothing needs attention right now." />
          ) : (
            openItems.map((o, i) => {
              const name = o.property?.name ?? "Property";
              const suburb = o.property?.suburb ?? "";
              return (
                <div key={o.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <Link
                    href={`/v2/maintenance/visits/${o.id}`}
                    className="flex items-center justify-between gap-2 py-1.5 transition-opacity hover:opacity-80"
                  >
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium">{o.title}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{name}{suburb ? `, ${suburb}` : ""}</p>
                    </div>
                    <EBadge tone={priorityTone(o.priority)} soft>{titleCase(o.priority)}</EBadge>
                  </Link>
                </div>
              );
            })
          )}
        </ECardBody>
        {openItems && openCount !== null && openCount > openItems.length ? (
          <p className="px-5 pb-4 text-sm">Showing {openItems.length} of {openCount}. <Link href="/v2/maintenance/tickets" className="underline">View all tickets</Link></p>
        ) : null}
      </ECard>

      {openNext ? (
        <EButton asChild variant="gold" size="lg" className="w-full">
          <Link href={`/v2/maintenance/visits/${openNext.id}`}>
            Open next: {openNext.title}{hhmm(openNext.scheduledFor) ? `, ${hhmm(openNext.scheduledFor)}` : ""}
          </Link>
        </EButton>
      ) : null}
    </div>
  );
}
