import { toZonedTime } from "date-fns-tz";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { CheckCircle2, Clock, PackageCheck, Weight } from "lucide-react";

export const metadata = { title: "Reports · Estate laundry" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const DAY = 86_400_000;

async function getReport() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const monthStart = new Date(todayStart.getTime() - 29 * DAY);

  const delivered = await db.laundryTask
    .findMany({
      where: { status: LaundryStatus.DROPPED, droppedAt: { gte: monthStart } },
      select: {
        bagWeightKg: true,
        dropoffCostAud: true,
        pickedUpAt: true,
        droppedAt: true,
        property: { select: { name: true, suburb: true } },
      },
      take: 1000,
    })
    .catch(() => [] as Array<{
      bagWeightKg: number | null;
      dropoffCostAud: number | null;
      pickedUpAt: Date | null;
      droppedAt: Date | null;
      property: { name: string | null; suburb: string | null } | null;
    }>);

  const loads = delivered.length;
  const totalKg = delivered.reduce((s, t) => s + (t.bagWeightKg ?? 0), 0);
  const totalCost = delivered.reduce((s, t) => s + (t.dropoffCostAud ?? 0), 0);

  // Average turnaround (pickup → return) in hours.
  const turnarounds = delivered
    .filter((t) => t.pickedUpAt && t.droppedAt)
    .map((t) => (t.droppedAt!.getTime() - t.pickedUpAt!.getTime()) / 3_600_000)
    .filter((h) => h >= 0);
  const avgTurnaroundH = turnarounds.length
    ? turnarounds.reduce((s, h) => s + h, 0) / turnarounds.length
    : 0;

  // Cost by property.
  const byProperty = new Map<string, { loads: number; kg: number; cost: number }>();
  for (const t of delivered) {
    const name = t.property?.name ?? "Property";
    const suburb = t.property?.suburb ?? "";
    const key = suburb ? `${name}, ${suburb}` : name;
    const prev = byProperty.get(key) ?? { loads: 0, kg: 0, cost: 0 };
    byProperty.set(key, {
      loads: prev.loads + 1,
      kg: prev.kg + (t.bagWeightKg ?? 0),
      cost: prev.cost + (t.dropoffCostAud ?? 0),
    });
  }
  const rows = Array.from(byProperty.entries()).sort((a, b) => b[1].loads - a[1].loads).slice(0, 12);

  return { loads, totalKg, totalCost, avgTurnaroundH, rows };
}

export default async function LaundryReportsPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const { loads, totalKg, totalCost, avgTurnaroundH, rows } = await getReport();

  const turnaround =
    avgTurnaroundH >= 24 ? `${(avgTurnaroundH / 24).toFixed(1)} d` : `${Math.round(avgTurnaroundH)} h`;

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Reporting" title="Reports" description="Completed laundry over the last 30 days." />

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Loads returned" value={String(loads)} delta="last 30 days" deltaTone="neutral" icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="Total weight" value={`${totalKg.toFixed(0)} kg`} delta="processed" deltaTone="neutral" icon={<Weight className="h-4 w-4" />} />
        <EStatCard label="Avg turnaround" value={turnaround} delta="pickup → return" deltaTone="neutral" icon={<Clock className="h-4 w-4" />} />
        <EStatCard label="Total cost" value={`$${totalCost.toFixed(0)}`} delta="drop-off charges" deltaTone="neutral" icon={<CheckCircle2 className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader>
          <ECardTitle>By property · 30 days</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-1">
          {rows.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No completed loads" description="Nothing has been returned in the last 30 days." />
          ) : (
            rows.map(([name, agg], i) => (
              <div key={name}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-center justify-between gap-3 py-2">
                  <p className="min-w-0 truncate text-[0.875rem] font-medium">{name}</p>
                  <div className="flex flex-shrink-0 items-center gap-4">
                    <span className="e-numeral text-[0.9375rem]">{agg.loads}</span>
                    {agg.kg > 0 ? (
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{agg.kg.toFixed(1)} kg</span>
                    ) : null}
                    {agg.cost > 0 ? (
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">${agg.cost.toFixed(0)}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
