import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { MaintenanceStatus, MaintenancePriority, MaintenanceAction, Role } from "@prisma/client";
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
import { CheckCircle2, Package, Timer, Wrench } from "lucide-react";

export const metadata = { title: "Today · Estate maintenance" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
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

type OpenItem = {
  id: string;
  title: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  property: { name: string | null; suburb: string | null } | null;
};

async function getMaintenance() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const [openItems, dueToday, replacements, closedWeek] = await Promise.all([
    db.propertyMaintenanceItem
      .findMany({
        where: { status: { in: OPEN_STATUSES } },
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
      .catch(() => [] as OpenItem[]),
    db.propertyMaintenanceItem
      .count({ where: { status: { in: OPEN_STATUSES }, scheduledFor: { gte: todayStart, lt: todayEnd } } })
      .catch(() => 0),
    db.propertyMaintenanceItem
      .count({
        where: {
          status: { in: OPEN_STATUSES },
          recommendedAction: { in: [MaintenanceAction.REPLACE, MaintenanceAction.RESTOCK] },
        },
      })
      .catch(() => 0),
    db.propertyMaintenanceItem
      .count({ where: { status: MaintenanceStatus.RESOLVED, resolvedAt: { gte: weekStart } } })
      .catch(() => 0),
  ]);

  return { openItems, dueToday, replacements, closedWeek };
}

export default async function MaintenanceTodayPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const { openItems, dueToday, replacements, closedWeek } = await getMaintenance();

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>MAINTENANCE · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s work orders.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Open tickets" value={String(openItems.length)} delta="active" deltaTone="neutral" icon={<Wrench className="h-4 w-4" />} />
        <EStatCard label="Due today" value={String(dueToday)} delta="scheduled" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Replacements" value={String(replacements)} delta="to order / restock" deltaTone="neutral" icon={<Package className="h-4 w-4" />} />
        <EStatCard label="Closed · week" value={String(closedWeek)} delta="resolved" icon={<CheckCircle2 className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader><ECardTitle>Open tickets</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {openItems.length === 0 ? (
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
      </ECard>
    </div>
  );
}
