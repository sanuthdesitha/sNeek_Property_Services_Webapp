import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listStaffDirectory } from "@/lib/workforce/service";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { WorkforceSubnav } from "@/components/v2/admin/workforce/workforce-subnav";
import { RosterTable, type RosterRow } from "@/components/v2/admin/workforce/roster-table";

export const metadata = { title: "Roster · Estate workforce" };
export const dynamic = "force-dynamic";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.ASSIGNED,
  JobStatus.OFFERED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

export default async function WorkforceRosterPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const directory = await listStaffDirectory().catch(() => []);
  const ids = directory.map((u) => u.id);

  const [presenceRows, activeJobRows] = await Promise.all([
    db.user
      .findMany({ where: { id: { in: ids } }, select: { id: true, lastSeenAt: true } })
      .catch(() => [] as Array<{ id: string; lastSeenAt: Date | null }>),
    db.jobAssignment
      .groupBy({
        by: ["userId"],
        where: { removedAt: null, userId: { in: ids }, job: { status: { in: ACTIVE_JOB_STATUSES } } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ userId: string; _count: { _all: number } }>),
  ]);

  const presenceMap = new Map(presenceRows.map((r) => [r.id, r.lastSeenAt]));
  const activeMap = new Map(activeJobRows.map((r) => [r.userId, r._count._all]));

  const rows: RosterRow[] = directory.map((u) => ({
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    image: u.image,
    role: u.role,
    department: u.extendedProfile?.department ?? null,
    location: u.extendedProfile?.baseLocation ?? null,
    qaAverage: u.qaAverage,
    qaReviewCount: u.qaReviewCount,
    verifiedDocumentCount: u.verifiedDocumentCount,
    pendingDocumentCount: u.pendingDocumentCount,
    recognitionCount: u.publicRecognitionCount,
    activeJobs: activeMap.get(u.id) ?? 0,
    lastSeenAt: presenceMap.get(u.id)?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team roster"
        description="Live status, workload and performance for every active team member."
      />
      <WorkforceSubnav active="roster" />
      <RosterTable rows={rows} />
    </div>
  );
}
