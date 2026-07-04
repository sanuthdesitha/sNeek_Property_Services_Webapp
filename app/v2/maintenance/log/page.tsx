import { MaintenanceStatus, MaintenanceOutcome, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, ECard, ECardBody, EEmptyState, EPageHeader, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Log · Estate maintenance" };
export const dynamic = "force-dynamic";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type LogRow = {
  id: string;
  title: string;
  outcome: MaintenanceOutcome | null;
  resolvedAt: Date | null;
  property: { name: string | null; suburb: string | null } | null;
};

async function getLog(): Promise<LogRow[]> {
  return db.propertyMaintenanceItem
    .findMany({
      where: { status: { in: [MaintenanceStatus.RESOLVED, MaintenanceStatus.DISMISSED] } },
      orderBy: [{ resolvedAt: "desc" }],
      take: 40,
      select: {
        id: true,
        title: true,
        outcome: true,
        resolvedAt: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => [] as LogRow[]);
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default async function MaintenanceLogPage() {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const log = await getLog();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="History" title="Log" description="Completed maintenance record." />
      {log.length === 0 ? (
        <EEmptyState eyebrow="Quiet" title="No history yet" description="Resolved maintenance items will appear here." />
      ) : (
        <ECard>
          <ECardBody className="space-y-1 pt-6">
            {log.map((l, i) => {
              const name = l.property?.name ?? "Property";
              const suburb = l.property?.suburb ?? "";
              return (
                <div key={l.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium">{l.title}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{name}{suburb ? `, ${suburb}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">{formatDate(l.resolvedAt)}</span>
                      <EBadge tone="success" soft>{l.outcome ? titleCase(l.outcome) : "Done"}</EBadge>
                    </div>
                  </div>
                </div>
              );
            })}
          </ECardBody>
        </ECard>
      )}
    </div>
  );
}
