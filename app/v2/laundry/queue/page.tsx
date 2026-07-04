import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Queue · Estate laundry" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

const STAGES: { name: string; status: LaundryStatus; tone: Tone }[] = [
  { name: "Pending", status: LaundryStatus.PENDING, tone: "neutral" },
  { name: "Confirmed", status: LaundryStatus.CONFIRMED, tone: "primary" },
  { name: "Picked up", status: LaundryStatus.PICKED_UP, tone: "info" },
  { name: "Delivered", status: LaundryStatus.DROPPED, tone: "success" },
];

type QueueTask = {
  id: string;
  status: LaundryStatus;
  bagWeightKg: number | null;
  property: { name: string | null; suburb: string | null } | null;
};

async function getQueue(): Promise<QueueTask[]> {
  return db.laundryTask
    .findMany({
      where: {
        noPickupRequired: false,
        status: { in: [LaundryStatus.PENDING, LaundryStatus.CONFIRMED, LaundryStatus.PICKED_UP, LaundryStatus.DROPPED] },
      },
      orderBy: [{ pickupDate: "asc" }],
      take: 60,
      select: {
        id: true,
        status: true,
        bagWeightKg: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => [] as QueueTask[]);
}

export default async function LaundryQueuePage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const tasks = await getQueue();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Board" title="Queue" description="Every set, by stage." />
      {tasks.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="Nothing in the queue" description="No active laundry sets right now." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map((s) => {
            const items = tasks.filter((t) => t.status === s.status);
            return (
              <ECard key={s.name}>
                <ECardBody className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">{s.name}</p>
                    <EBadge tone={s.tone} soft>{items.length}</EBadge>
                  </div>
                  <div className="space-y-2">
                    {items.length === 0 ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">None</p>
                    ) : (
                      items.map((it) => {
                        const name = it.property?.name ?? "Property";
                        const suburb = it.property?.suburb ?? "";
                        const weight = it.bagWeightKg ? ` · ${it.bagWeightKg} kg` : "";
                        return (
                          <div key={it.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
                            {name}{suburb ? `, ${suburb}` : ""}{weight}
                          </div>
                        );
                      })
                    )}
                  </div>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
