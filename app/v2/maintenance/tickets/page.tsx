import Link from "next/link";
import { MaintenanceStatus, MaintenancePriority, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight } from "lucide-react";

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
  scheduledFor: Date | null;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  outcome: string | null;
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
        scheduledFor: true,
        enRouteAt: true,
        arrivedAt: true,
        clockInAt: true,
        clockOutAt: true,
        outcome: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => [] as TicketRow[]);
}

/** Friendly visit stage derived from lifecycle timestamps — same logic as the
 *  v1 worker jobs list. */
function visitStage(t: TicketRow): { label: string; tone: Tone } {
  if (t.clockOutAt || t.outcome) return { label: "Done", tone: "success" };
  if (t.clockInAt) return { label: "On site", tone: "warning" };
  if (t.arrivedAt) return { label: "Arrived", tone: "warning" };
  if (t.enRouteAt) return { label: "En route", tone: "warning" };
  return { label: "Scheduled", tone: "neutral" };
}

function formatSchedule(d: Date | null): string {
  if (!d) return "Not scheduled";
  return new Date(d).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
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
            const stage = visitStage(t);
            return (
              <Link key={t.id} href={`/v2/maintenance/visits/${t.id}`} className="block">
                <ECard>
                  <ECardBody className="flex items-center gap-3 pt-6">
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.875rem] font-medium">{t.title}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{name}{suburb ? `, ${suburb}` : ""}</p>
                      <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{formatSchedule(t.scheduledFor)}</p>
                    </div>
                    <EBadge tone={priorityTone(t.priority)} soft>{titleCase(t.priority)}</EBadge>
                    <EBadge tone={stage.tone} soft>{stage.label}</EBadge>
                    <span className="hidden text-[0.75rem] text-[hsl(var(--e-text-faint))] sm:inline">{titleCase(t.status)}</span>
                    <EButton variant="outline" size="sm">
                      Open <ChevronRight className="h-4 w-4" />
                    </EButton>
                  </ECardBody>
                </ECard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
