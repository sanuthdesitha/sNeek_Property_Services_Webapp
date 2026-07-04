import { MaintenanceStatus, MaintenancePriority, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Tickets · Estate maintenance" };
export const dynamic = "force-dynamic";

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

type TicketRow = {
  id: string;
  title: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  property: { name: string | null; suburb: string | null } | null;
};

async function getTickets(): Promise<TicketRow[]> {
  return db.propertyMaintenanceItem
    .findMany({
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => [] as TicketRow[]);
}

export default async function MaintenanceTicketsPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const tickets = await getTickets();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Work orders" title="Tickets" description="Every maintenance request." />
      {tickets.length === 0 ? (
        <EEmptyState eyebrow="All clear" title="No tickets" description="Maintenance requests will appear here." />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const name = t.property?.name ?? "Property";
            const suburb = t.property?.suburb ?? "";
            return (
              <ECard key={t.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium">{t.title}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{name}{suburb ? `, ${suburb}` : ""}</p>
                  </div>
                  <EBadge tone={priorityTone(t.priority)} soft>{titleCase(t.priority)}</EBadge>
                  <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{titleCase(t.status)}</span>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
