import { toZonedTime } from "date-fns-tz";
import { LaundryStatus, Role } from "@prisma/client";
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
import { PackageCheck, Timer, Truck, Waves } from "lucide-react";

export const metadata = { title: "Today · Estate laundry" };
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

  // Mirrors app/v2/admin/laundry/page.tsx getLaundry().
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
    .catch(() => [] as Array<{ id: string; status: LaundryStatus; bagWeightKg: number | null; property: { name: string | null; suburb: string | null } | null }>);

  const inQueue = tasks.filter((t) => t.status === LaundryStatus.PENDING || t.status === LaundryStatus.CONFIRMED).length;
  const inTransit = tasks.filter((t) => t.status === LaundryStatus.PICKED_UP).length;
  const ready = tasks.filter((t) => t.status === LaundryStatus.DROPPED).length;

  return { tasks, inQueue, inTransit, ready };
}

export default async function LaundryTodayPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const { tasks, inQueue, inTransit, ready } = await getLaundry();

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>LAUNDRY OPERATIONS · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s linen.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="In queue" value={String(inQueue)} delta="pending" deltaTone="neutral" icon={<Waves className="h-4 w-4" />} />
        <EStatCard label="In transit" value={String(inTransit)} delta="picked up" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Delivered" value={String(ready)} delta="today" icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="Loads today" value={String(tasks.length)} delta="in the pipeline" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader><ECardTitle>Live queue</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {tasks.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No laundry scheduled" description="Nothing in the laundry pipeline right now." />
          ) : (
            tasks.map((t, i) => {
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
    </div>
  );
}
