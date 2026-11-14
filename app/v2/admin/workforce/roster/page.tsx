import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { listStaffDirectory } from "@/lib/workforce/service";
import { loadComplianceData } from "@/lib/workforce/compliance-load";
import { loadWorkforceAreaSummary } from "@/lib/workforce/area-counts";
import { WorkforceArea } from "@/components/v2/admin/workforce/workforce-area";
import { RosterTable, type RosterRow } from "@/components/v2/admin/workforce/roster-table";

export const metadata = { title: "Roster · Workforce" };
export const dynamic = "force-dynamic";

const ACTIVE_JOB_STATUSES: JobStatus[] = [JobStatus.ASSIGNED, JobStatus.OFFERED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.PAUSED];

/** Workforce › Roster: active cleaners and laundry staff. */
export default async function WorkforceRosterPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [directoryRaw, compliance, settings] = await Promise.all([
    listStaffDirectory().catch(() => null),
    loadComplianceData(),
    getAppSettings().catch(() => null),
  ]);
  const summary = await loadWorkforceAreaSummary(compliance);
  const timeZone = settings?.timezone || "Australia/Sydney";
  // Everyone the old roster listed; the tab opens on cleaners (chips: Cleaners, Laundry, Everyone).
  const directory = directoryRaw ?? [];
  const ids = directory.map((person) => person.id);

  const [people, activeRows, inProgressRows] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, lastSeenAt: true, createdAt: true, extraRoles: { select: { role: true } } } }).catch(() => []),
    db.jobAssignment
      .groupBy({ by: ["userId"], where: { removedAt: null, userId: { in: ids }, job: { status: { in: ACTIVE_JOB_STATUSES } } }, _count: { _all: true } })
      .catch(() => [] as Array<{ userId: string; _count: { _all: number } }>),
    db.jobAssignment
      .groupBy({ by: ["userId"], where: { removedAt: null, userId: { in: ids }, job: { status: JobStatus.IN_PROGRESS } }, _count: { _all: true } })
      .catch(() => [] as Array<{ userId: string; _count: { _all: number } }>),
  ]);
  const personMap = new Map(people.map((row) => [row.id, row]));
  const activeMap = new Map(activeRows.map((row) => [row.userId, row._count._all]));
  const inProgressMap = new Map(inProgressRows.map((row) => [row.userId, row._count._all]));
  const complianceRows = compliance.status === "ready" ? compliance.rows : [];
  const countState = (userId: string, state: "EXPIRED" | "EXPIRING") =>
    complianceRows.filter((row) => row.personId === userId && row.kind === "document" && row.state === state).length;

  const rows: RosterRow[] = directory.map((person) => ({
    id: person.id,
    name: person.name ?? person.email,
    email: person.email,
    image: person.image,
    role: person.role,
    extraRoles: (personMap.get(person.id)?.extraRoles ?? []).map((row) => row.role),
    location: person.extendedProfile?.baseLocation ?? null,
    startedAt: (personMap.get(person.id)?.createdAt ?? new Date()).toISOString(),
    qaAverage: person.qaAverage,
    qaReviewCount: person.qaReviewCount,
    verifiedDocumentCount: person.verifiedDocumentCount,
    pendingDocumentCount: person.pendingDocumentCount,
    expiringDocumentCount: countState(person.id, "EXPIRING"),
    expiredDocumentCount: countState(person.id, "EXPIRED"),
    recognitionCount: person.publicRecognitionCount,
    activeJobs: activeMap.get(person.id) ?? 0,
    inProgressJobs: inProgressMap.get(person.id) ?? 0,
    lastSeenAt: personMap.get(person.id)?.lastSeenAt?.toISOString() ?? null,
  }));

  return (
    <WorkforceArea active="roster" summary={summary}>
      {directoryRaw === null ? (
        <div role="alert" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
          <p className="font-[600]">The roster could not be loaded.</p>
          <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Reload the page to try again.</p>
        </div>
      ) : (
        <RosterTable rows={rows} timeZone={timeZone} />
      )}
    </WorkforceArea>
  );
}
