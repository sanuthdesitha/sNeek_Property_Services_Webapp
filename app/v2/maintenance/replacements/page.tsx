import { MaintenanceStatus, MaintenanceAction, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Replacements · Estate maintenance" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function statusTone(status: MaintenanceStatus): Tone {
  switch (status) {
    case MaintenanceStatus.ORDERED:
      return "info";
    case MaintenanceStatus.IN_PROGRESS:
      return "primary";
    case MaintenanceStatus.RESOLVED:
      return "success";
    case MaintenanceStatus.DISMISSED:
      return "neutral";
    default:
      return "warning";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type ReplacementRow = {
  id: string;
  title: string;
  status: MaintenanceStatus;
  estimatedCost: number | null;
  quotedCost: number | null;
  property: { name: string | null; suburb: string | null } | null;
};

async function getReplacements(): Promise<ReplacementRow[]> {
  return db.propertyMaintenanceItem
    .findMany({
      where: { recommendedAction: { in: [MaintenanceAction.REPLACE, MaintenanceAction.RESTOCK] } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        estimatedCost: true,
        quotedCost: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => [] as ReplacementRow[]);
}

function formatCost(item: ReplacementRow): string | null {
  const cost = item.quotedCost ?? item.estimatedCost;
  if (cost == null) return null;
  return `$${cost.toFixed(cost % 1 === 0 ? 0 : 2)}`;
}

export default async function MaintenanceReplacementsPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const items = await getReplacements();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Airbnb assets" title="Replacements" description="Track worn items and reorders." />
      {items.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No replacements" description="Nothing to order or restock right now." />
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const name = it.property?.name ?? "Property";
            const suburb = it.property?.suburb ?? "";
            const cost = formatCost(it);
            return (
              <ECard key={it.id}>
                <ECardBody className="flex items-center gap-3 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium">{it.title}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{name}{suburb ? `, ${suburb}` : ""}</p>
                  </div>
                  {cost ? <span className="e-numeral text-[0.9375rem]">{cost}</span> : null}
                  <EBadge tone={statusTone(it.status)} soft>{titleCase(it.status)}</EBadge>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
