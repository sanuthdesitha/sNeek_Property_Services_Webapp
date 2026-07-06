import { QaReworkSeverity, QaReworkTransferStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EBadge, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Rework · Estate QA" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function severityTone(sev: QaReworkSeverity): Tone {
  switch (sev) {
    case QaReworkSeverity.MAJOR:
      return "danger";
    case QaReworkSeverity.MODERATE:
      return "warning";
    default:
      return "info";
  }
}

function statusTone(status: QaReworkTransferStatus): Tone {
  switch (status) {
    case QaReworkTransferStatus.APPROVED:
      return "success";
    case QaReworkTransferStatus.REJECTED:
      return "neutral";
    default:
      return "warning";
  }
}

type ReworkRow = {
  id: string;
  severity: QaReworkSeverity;
  status: QaReworkTransferStatus;
  reason: string;
  areas: unknown;
  cleaner: { name: string | null } | null;
  job: { property: { name: string | null; suburb: string | null } | null } | null;
};

async function getRework(): Promise<ReworkRow[]> {
  return db.qaReworkTransfer
    .findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        severity: true,
        status: true,
        reason: true,
        areas: true,
        cleaner: { select: { name: true } },
        job: { select: { property: { select: { name: true, suburb: true } } } },
      },
    })
    .catch(() => [] as ReworkRow[]);
}

function areaSummary(areas: unknown): string | null {
  if (Array.isArray(areas) && areas.length > 0) {
    return areas.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" · ");
  }
  return null;
}

export default async function QaReworkPage() {
  await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const flagged = await getRework();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Follow-up" title="Rework" description="Areas flagged for correction." />
      {flagged.length === 0 ? (
        <EEmptyState eyebrow="All clear" title="Nothing flagged" description="No rework has been raised." />
      ) : (
        <div className="space-y-3">
          {flagged.map((f) => {
            const propName = f.job?.property?.name ?? "Property";
            const suburb = f.job?.property?.suburb ?? "";
            const areas = areaSummary(f.areas);
            return (
              <ECard key={f.id}>
                <ECardBody className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.875rem] font-medium">{propName}{suburb ? `, ${suburb}` : ""}</p>
                    <div className="flex items-center gap-2">
                      <EBadge tone={severityTone(f.severity)} soft>{titleCase(f.severity)}</EBadge>
                      <EBadge tone={statusTone(f.status)} soft>{titleCase(f.status)}</EBadge>
                    </div>
                  </div>
                  {areas ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{areas}</p> : null}
                  <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{f.reason}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Cleaner: {f.cleaner?.name ?? "Unassigned"}</p>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}
    </div>
  );
}
