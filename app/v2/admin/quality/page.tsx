import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { QaAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ClipboardCheck, ShieldCheck, CheckCircle2 } from "lucide-react";

export const metadata = { title: "Quality · Estate admin" };
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

async function getQuality() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const [queue, awaiting, inProgress, completedToday] = await Promise.all([
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
  ]);

  return { queue, awaiting, inProgress, completedToday };
}

export default async function AdminQualityPage() {
  const { queue, awaiting, inProgress, completedToday } = await getQuality();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Quality"
        description="QA queue, inspection templates, and reclean reviews."
        actions={
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/admin/qa-templates">QA templates</Link>
          </EButton>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Awaiting QA" value={String(awaiting)} delta="unpicked" deltaTone="neutral" icon={<ShieldCheck className="h-4 w-4" />} />
        <EStatCard label="In progress" value={String(inProgress)} delta="being inspected" deltaTone="neutral" icon={<ClipboardCheck className="h-4 w-4" />} />
        <EStatCard label="Completed today" value={String(completedToday)} delta="reviews closed" deltaTone="neutral" icon={<CheckCircle2 className="h-4 w-4" />} />
      </section>

      <div className="space-y-3">
        <span className="e-eyebrow">INSPECTION QUEUE</span>
        {queue.length === 0 ? (
          <EEmptyState eyebrow="All clear" title="No inspections waiting" description="Every submitted job has been reviewed." />
        ) : (
          queue.map((q) => {
            const propName = q.job?.property?.name ?? "Property";
            const suburb = q.job?.property?.suburb ?? "";
            const cleaner = q.job?.assignments[0]?.user?.name ?? "Unassigned";
            const jobType = q.job?.jobType ? titleCase(q.job.jobType) : "Clean";
            return (
              <ECard key={q.id}>
                <ECardBody className="flex flex-wrap items-center gap-4 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem] font-[550]">{propName}{suburb ? `, ${suburb}` : ""}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{jobType} · {cleaner}</p>
                  </div>
                  <EBadge tone={q.status === QaAssignmentStatus.IN_PROGRESS ? "info" : "primary"} soft>{titleCase(q.status)}</EBadge>
                  <EButton asChild variant="gold" size="sm">
                    <Link href={`/v2/admin/quality/${q.id}`}>Inspect</Link>
                  </EButton>
                </ECardBody>
              </ECard>
            );
          })
        )}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data from your workspace.</p>
    </div>
  );
}
