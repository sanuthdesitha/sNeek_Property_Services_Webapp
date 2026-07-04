import { toZonedTime } from "date-fns-tz";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { AlertTriangle, ClipboardCheck, Star, Timer } from "lucide-react";

export const metadata = { title: "Today · Estate QA" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const OPEN_STATUSES = [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS];

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Mirrors app/v2/admin/quality/page.tsx getQuality().
async function getQuality() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const [queue, awaiting, inProgress, completedToday, reworkToday] = await Promise.all([
    db.qaAssignment
      .findMany({
        where: { status: { in: OPEN_STATUSES } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 12,
        select: {
          id: true,
          status: true,
          dueAt: true,
          job: {
            select: {
              jobType: true,
              property: { select: { name: true, suburb: true } },
              assignments: { select: { user: { select: { name: true } } }, take: 1 },
            },
          },
        },
      })
      .catch(() => []),
    db.qaAssignment.count({ where: { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } } }).catch(() => 0),
    db.qaAssignment.count({ where: { status: QaAssignmentStatus.IN_PROGRESS } }).catch(() => 0),
    db.qaAssignment
      .count({ where: { status: QaAssignmentStatus.COMPLETED, completedAt: { gte: todayStart, lt: todayEnd } } })
      .catch(() => 0),
    db.qaReworkTransfer.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }).catch(() => 0),
  ]);

  return { queue, awaiting, inProgress, completedToday, reworkToday };
}

export default async function QaTodayPage() {
  await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const { queue, awaiting, inProgress, completedToday, reworkToday } = await getQuality();

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>QUALITY ASSURANCE · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s reviews.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Awaiting review" value={String(awaiting)} delta="unpicked" deltaTone="neutral" icon={<ClipboardCheck className="h-4 w-4" />} />
        <EStatCard label="In progress" value={String(inProgress)} delta="being inspected" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Reviewed today" value={String(completedToday)} delta="closed" icon={<Star className="h-4 w-4" />} />
        <EStatCard label="Rework flagged" value={String(reworkToday)} delta="today" deltaTone="neutral" icon={<AlertTriangle className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader><ECardTitle>Inspection queue</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {queue.length === 0 ? (
            <EEmptyState eyebrow="All clear" title="No inspections waiting" description="Every submitted job has been reviewed." />
          ) : (
            queue.map((q, i) => {
              const propName = q.job?.property?.name ?? "Property";
              const suburb = q.job?.property?.suburb ?? "";
              const cleaner = q.job?.assignments[0]?.user?.name ?? "Unassigned";
              const jobType = q.job?.jobType ? titleCase(q.job.jobType) : "Clean";
              return (
                <div key={q.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium">{propName}{suburb ? `, ${suburb}` : ""}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{jobType} · {cleaner}</p>
                    </div>
                    <EBadge tone={q.status === QaAssignmentStatus.IN_PROGRESS ? "info" : "primary"} soft>{titleCase(q.status)}</EBadge>
                  </div>
                </div>
              );
            })
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
