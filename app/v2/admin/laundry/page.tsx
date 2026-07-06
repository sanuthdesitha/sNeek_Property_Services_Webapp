import { toZonedTime } from "date-fns-tz";
import { LaundryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { EBadge, EButton, ECard, ECardBody, EPageHeader, EStatCard, EEmptyState } from "@/components/v2/ui/primitives";
import { PackageCheck, Shirt, Truck } from "lucide-react";

export const metadata = { title: "Laundry · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

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
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const tasks = await db.laundryTask
    .findMany({
      where: {
        noPickupRequired: false,
        OR: [
          { pickupDate: { gte: todayStart, lt: todayEnd } },
          { dropoffDate: { gte: todayStart, lt: todayEnd } },
          { status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.CONFIRMED] } },
        ],
      },
      orderBy: [{ pickupDate: "asc" }],
      take: 20,
      select: {
        id: true,
        status: true,
        bagWeightKg: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => []);

  return {
    tasks,
    inTransit: tasks.filter((t) => t.status === LaundryStatus.PICKED_UP).length,
    delivered: tasks.filter((t) => t.status === LaundryStatus.DROPPED).length,
  };
}

export default async function AdminLaundryPage() {
  const { tasks, inTransit, delivered } = await getLaundry();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Operations" title="Laundry" description="Runs, live tracking, suppliers." actions={<EButton variant="gold" size="sm">New run</EButton>} />
      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Loads today" value={String(tasks.length)} delta="in the pipeline" deltaTone="neutral" icon={<Shirt className="h-4 w-4" />} />
        <EStatCard label="In transit" value={String(inTransit)} delta="picked up" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
        <EStatCard label="Delivered" value={String(delivered)} delta="today" icon={<PackageCheck className="h-4 w-4" />} />
      </section>
      <div className="space-y-3">
        <span className="e-eyebrow">TODAY&apos;S RUNS</span>
        {tasks.length === 0 ? (
          <EEmptyState eyebrow="Quiet" title="No laundry scheduled" description="Nothing in the laundry pipeline right now." />
        ) : (
          tasks.map((t) => {
            const name = t.property?.name ?? "Property";
            const suburb = t.property?.suburb ?? "";
            return (
              <ECard key={t.id}>
                <ECardBody className="flex items-center gap-4 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem] font-[550]">{name}{suburb ? `, ${suburb}` : ""}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {t.bagWeightKg ? `${t.bagWeightKg} kg` : "Weight t.b.c."}
                    </p>
                  </div>
                  <EBadge tone={statusTone(t.status)} soft>{statusLabel(t.status)}</EBadge>
                  <EButton variant="outline" size="sm">Track</EButton>
                </ECardBody>
              </ECard>
            );
          })
        )}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data from your workspace.</p>
    </div>
  );
}
