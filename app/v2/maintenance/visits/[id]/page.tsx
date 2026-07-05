import Link from "next/link";
import { notFound } from "next/navigation";
import { MaintenancePriority, MaintenanceStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EThread,
} from "@/components/v2/ui/primitives";
import { MapPin, Wrench } from "lucide-react";

export const metadata = { title: "Visit · Estate maintenance" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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

function statusTone(s: MaintenanceStatus): Tone {
  switch (s) {
    case MaintenanceStatus.RESOLVED:
      return "success";
    case MaintenanceStatus.IN_PROGRESS:
    case MaintenanceStatus.ORDERED:
      return "info";
    case MaintenanceStatus.OPEN:
    case MaintenanceStatus.ACKNOWLEDGED:
      return "primary";
    default:
      return "neutral";
  }
}

// Read summary sourced the same way as GET /api/maintenance/[id] (the maintenance
// item by id, with property). The on-site visit workflow (start/complete, photos,
// notes) is the live client page at /maintenance/visits/[id]; we link to it.
export default async function MaintenanceVisitPage({ params }: { params: { id: string } }) {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);

  const item = await db.propertyMaintenanceItem
    .findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        description: true,
        area: true,
        category: true,
        priority: true,
        status: true,
        recommendedAction: true,
        estimatedCost: true,
        scheduledFor: true,
        property: { select: { name: true, suburb: true, address: true } },
      },
    })
    .catch(() => null);

  if (!item) notFound();

  const propName = item.property?.name ?? "Property";
  const suburb = item.property?.suburb ?? "";
  const address = item.property?.address ?? "";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Maintenance visit"
        title={item.title}
        description={`${propName}${suburb ? `, ${suburb}` : ""}`}
        actions={
          <EButton asChild variant="gold"><Link href={`/maintenance/visits/${item.id}`}>Open visit workspace</Link></EButton>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <ECard className="p-5">
          <p className="e-eyebrow">Priority</p>
          <div className="mt-3">
            <EBadge tone={priorityTone(item.priority)} soft>{titleCase(item.priority)}</EBadge>
          </div>
        </ECard>
        <ECard className="p-5">
          <p className="e-eyebrow">Status</p>
          <div className="mt-3">
            <EBadge tone={statusTone(item.status)} soft>{titleCase(item.status)}</EBadge>
          </div>
        </ECard>
        <ECard className="p-5">
          <div className="flex items-start justify-between">
            <p className="e-eyebrow">Recommended</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
              <Wrench className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-[0.9375rem] font-medium">{titleCase(item.recommendedAction)}</p>
          {item.estimatedCost != null ? (
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Est. ${item.estimatedCost.toLocaleString()}
            </p>
          ) : null}
        </ECard>
      </section>

      <ECard>
        <ECardHeader><ECardTitle>Work order</ECardTitle></ECardHeader>
        <ECardBody className="space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--e-muted-foreground))]" />
            <div>
              <p className="text-[0.875rem] font-medium">{propName}</p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {[address, suburb].filter(Boolean).join(", ") || "Address on file"}
              </p>
            </div>
          </div>
          <div className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {titleCase(item.category)}{item.area ? ` · ${item.area}` : ""}
          </div>
          {item.description ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{item.description}</p>
          ) : null}
          <EThread />
          <EAlert tone="info" title="On-site actions live in the workspace">
            Starting the visit, logging time, capturing before/after photos and marking the item
            resolved run in the live maintenance visit workspace. Open it to work the job.
          </EAlert>
          <div>
            <EButton asChild variant="gold"><Link href={`/maintenance/visits/${item.id}`}>Open visit workspace</Link></EButton>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
