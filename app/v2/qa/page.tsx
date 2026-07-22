import { toZonedTime } from "date-fns-tz";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EEyebrow, EStatCard } from "@/components/v2/ui/primitives";
import { AlertTriangle, ClipboardCheck, Star, Timer } from "lucide-react";
import { QaQueueWorkspace } from "@/components/v2/qa/qa-queue-workspace";
import { QaDayPlanner } from "@/components/v2/qa/qa-day-planner";

export const metadata = { title: "Today · Estate QA" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

async function getQuality() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const [awaiting, inProgress, completedToday, reworkToday] = await Promise.all([
    db.qaAssignment.count({ where: { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } } }).catch(() => 0),
    db.qaAssignment.count({ where: { status: QaAssignmentStatus.IN_PROGRESS } }).catch(() => 0),
    db.qaAssignment
      .count({ where: { status: QaAssignmentStatus.COMPLETED, completedAt: { gte: todayStart, lt: todayEnd } } })
      .catch(() => 0),
    db.qaReworkTransfer.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }).catch(() => 0),
  ]);

  return { awaiting, inProgress, completedToday, reworkToday };
}

export default async function QaTodayPage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const { awaiting, inProgress, completedToday, reworkToday } = await getQuality();

  // Assigning inspections is an admin/ops responsibility — inspectors only review
  // jobs handed to them. Load the roster + show assign controls for admin/ops.
  const canAssign = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
  const inspectors = canAssign
    ? await db.user
        .findMany({
          where: { role: { in: [Role.QA_INSPECTOR, Role.OPS_MANAGER] }, isActive: true },
          select: { id: true, name: true, email: true, role: true },
          orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
        })
        .catch(() => [])
    : [];

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

      {canAssign ? <QaDayPlanner inspectors={inspectors} /> : null}

      <QaQueueWorkspace inspectors={inspectors} canAssign={canAssign} />
    </div>
  );
}
