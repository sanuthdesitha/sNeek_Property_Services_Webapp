import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EEyebrow, EStatCard } from "@/components/v2/ui/primitives";
import { AlertTriangle, ClipboardCheck, Star, Timer } from "lucide-react";
import { QaQueueWorkspace } from "@/components/v2/qa/qa-queue-workspace";
import { QaDayPlanner } from "@/components/v2/qa/qa-day-planner";
import { getAppSettings } from "@/lib/settings";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";

export const metadata = { title: "Today · Estate QA" };
export const dynamic = "force-dynamic";

/**
 * Today's tiles. These counted every assignment in the business, so an
 * inspector's "in progress" tile reported other inspectors' work — wrong on its
 * own, and actively confusing sitting above an assign-only queue. Admin and ops
 * keep the whole-board numbers; an inspector sees their own.
 */
async function getQuality(viewer: { id: string; role: Role }) {
  const today = sydneyTodayKey();
  const todayStart = sydneyDayStart(today);
  const todayEnd = sydneyDayStart(addDaysToKey(today, 1));

  const mine =
    viewer.role === Role.ADMIN || viewer.role === Role.OPS_MANAGER
      ? {}
      : qaAssignmentOwnerWhere(viewer.id);

  const [awaiting, inProgress, completedToday, reworkToday] = await Promise.all([
    db.qaAssignment
      .count({ where: { ...mine, status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } } })
      .catch(() => null),
    db.qaAssignment.count({ where: { ...mine, status: QaAssignmentStatus.IN_PROGRESS } }).catch(() => null),
    db.qaAssignment
      .count({ where: { ...mine, status: QaAssignmentStatus.COMPLETED, completedAt: { gte: todayStart, lt: todayEnd } } })
      .catch(() => null),
    // Rework transfers are a team-quality signal about CLEANERS, not this
    // inspector's workload, so they stay business-wide on purpose.
    db.qaReworkTransfer.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }).catch(() => null),
  ]);

  return { awaiting, inProgress, completedToday, reworkToday };
}

export default async function QaTodayPage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const { awaiting, inProgress, completedToday, reworkToday } = await getQuality({
    id: session.user.id,
    role: session.user.role as Role,
  });
  const unavailable = [awaiting, inProgress, completedToday, reworkToday].some((value) => value === null);
  const countLabel = (value: number | null) => value === null ? <span className="text-sm">Unavailable</span> : String(value);
  // QA-pay defaults drive the admin per-inspection pay editor preview.
  const settings = await getAppSettings();

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

      {unavailable ? (
        <div role="alert" className="border-l-4 border-red-600 px-4 py-3 text-sm">
          Some QA metrics could not be loaded. <a href="/v2/qa" className="underline">Retry</a>
        </div>
      ) : null}
      <p className="text-sm text-[hsl(var(--e-muted-foreground))]">
        {canAssign ? "Team inspection totals." : "Your assigned or picked-up inspection totals."} Rework is team-wide.
      </p>
      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Awaiting review" value={countLabel(awaiting)} delta="open or assigned" deltaTone="neutral" icon={<ClipboardCheck className="h-4 w-4" />} />
        <EStatCard label="In progress" value={countLabel(inProgress)} delta="being inspected" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Reviewed today" value={countLabel(completedToday)} delta="closed" deltaTone={completedToday === null ? "neutral" : "success"} icon={<Star className="h-4 w-4" />} />
        <EStatCard label="Rework flagged" value={countLabel(reworkToday)} delta="today, team-wide" deltaTone="neutral" icon={<AlertTriangle className="h-4 w-4" />} />
      </section>

      {canAssign ? <QaDayPlanner inspectors={inspectors} /> : null}

      <QaQueueWorkspace inspectors={inspectors} canAssign={canAssign} qaPaySettings={settings.qaPay} />
    </div>
  );
}
