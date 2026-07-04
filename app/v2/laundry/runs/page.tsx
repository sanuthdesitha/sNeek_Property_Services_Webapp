import { toZonedTime } from "date-fns-tz";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Runs · Estate laundry" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

// No dedicated route/run model exists in the schema; the two real "loops" the
// data supports are today's pickups and today's drop-offs, derived from
// LaundryTask pickupDate/dropoffDate + status.
type RunTask = {
  id: string;
  status: LaundryStatus;
  pickedUpAt: Date | null;
  droppedAt: Date | null;
  property: { name: string | null; suburb: string | null } | null;
};

async function getRuns() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const [pickups, dropoffs] = await Promise.all([
    db.laundryTask
      .findMany({
        where: { noPickupRequired: false, pickupDate: { gte: todayStart, lt: todayEnd } },
        orderBy: [{ pickupDate: "asc" }],
        take: 40,
        select: { id: true, status: true, pickedUpAt: true, droppedAt: true, property: { select: { name: true, suburb: true } } },
      })
      .catch(() => [] as RunTask[]),
    db.laundryTask
      .findMany({
        where: { dropoffDate: { gte: todayStart, lt: todayEnd } },
        orderBy: [{ dropoffDate: "asc" }],
        take: 40,
        select: { id: true, status: true, pickedUpAt: true, droppedAt: true, property: { select: { name: true, suburb: true } } },
      })
      .catch(() => [] as RunTask[]),
  ]);

  return { pickups, dropoffs };
}

function label(t: RunTask): string {
  const name = t.property?.name ?? "Property";
  const suburb = t.property?.suburb ?? "";
  return `${name}${suburb ? `, ${suburb}` : ""}`;
}

function RunCard({ title, tasks, kind }: { title: string; tasks: RunTask[]; kind: "pickup" | "dropoff" }) {
  const done = tasks.filter((t) => (kind === "pickup" ? t.pickedUpAt : t.droppedAt)).length;
  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">{title}</p>
          <EBadge tone={done === tasks.length ? "success" : "info"} soft>
            {done}/{tasks.length} done
          </EBadge>
        </div>
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">None scheduled</p>
          ) : (
            tasks.map((t) => {
              const complete = kind === "pickup" ? Boolean(t.pickedUpAt) : Boolean(t.droppedAt);
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
                  <span>{label(t)}</span>
                  <EBadge tone={complete ? "success" : "neutral"} soft>{complete ? "Done" : "Pending"}</EBadge>
                </div>
              );
            })
          )}
        </div>
      </ECardBody>
    </ECard>
  );
}

export default async function LaundryRunsPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const { pickups, dropoffs } = await getRuns();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Dispatch" title="Runs" description="Today's pickup and drop-off loops." />
      {pickups.length === 0 && dropoffs.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No runs today" description="No pickups or drop-offs are scheduled for today." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <RunCard title="Pickup loop" tasks={pickups} kind="pickup" />
          <RunCard title="Drop-off loop" tasks={dropoffs} kind="dropoff" />
        </div>
      )}
    </div>
  );
}
