import { formatInTimeZone } from "date-fns-tz";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { QaAssignmentStatus, QaReworkTransferStatus, Role } from "@prisma/client";
import { ListFilter } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EEyebrow, EStatCard } from "@/components/v2/ui/primitives";
import { OperationsDisclosure } from "@/components/operations/ui";
import { QaQueueWorkspace } from "@/components/v2/qa/qa-queue-workspace";
import { QaDayPlanner } from "@/components/v2/qa/qa-day-planner";
import { QaVisitOrder } from "@/components/v2/qa/today/qa-visit-order";
import { getAppSettings } from "@/lib/settings";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";
import { resolveReworkScope, reworkScopeWhere } from "@/lib/qa/rework-list";

export const metadata = { title: "Today · Estate QA" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

/**
 * Today's three figures (board: To inspect, Rework open, Done). An inspector
 * sees their own inspections; administrators and operations managers keep the
 * whole-board numbers. Rework open is the PENDING rework-transfer count in the
 * same scope as the Rework list and its tab badge (lib/qa/rework-list.ts): an
 * inspector's own rework, team-wide for the office. A failed count reads
 * "Unavailable", never 0.
 */
async function getTodayFigures(viewer: { id: string; role: Role }) {
  const today = sydneyTodayKey();
  const todayStart = sydneyDayStart(today);
  const todayEnd = sydneyDayStart(addDaysToKey(today, 1));
  const mine = viewer.role === Role.ADMIN || viewer.role === Role.OPS_MANAGER ? {} : qaAssignmentOwnerWhere(viewer.id);

  const [toInspect, reworkOpen, done] = await Promise.all([
    db.qaAssignment
      .count({
        where: {
          ...mine,
          status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
        },
      })
      .catch(() => null),
    db.qaReworkTransfer
      .count({
        where: {
          AND: [
            { status: QaReworkTransferStatus.PENDING },
            reworkScopeWhere(viewer, resolveReworkScope(viewer, null)),
          ],
        },
      })
      .catch(() => null),
    db.qaAssignment
      .count({ where: { ...mine, status: QaAssignmentStatus.COMPLETED, completedAt: { gte: todayStart, lt: todayEnd } } })
      .catch(() => null),
  ]);
  return { today, toInspect, reworkOpen, done };
}

function figure(value: number | null) {
  return value === null ? <span className="text-sm">Unavailable</span> : String(value);
}

export default async function QaTodayPage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const role = session.user.role as Role;
  const { today, toInspect, reworkOpen, done } = await getTodayFigures({ id: session.user.id, role });
  const unavailable = [toInspect, reworkOpen, done].some((value) => value === null);
  const settings = await getAppSettings().catch(() => null);

  // Assigning inspections is an office responsibility — inspectors only review
  // jobs handed to them. The roster and assign controls load for admin/ops only.
  const canAssign = role === Role.ADMIN || role === Role.OPS_MANAGER;
  const inspectors = canAssign
    ? await db.user
        .findMany({
          where: { role: { in: [Role.QA_INSPECTOR, Role.OPS_MANAGER] }, isActive: true },
          select: { id: true, name: true, email: true, role: true },
          orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
        })
        .catch(() => [])
    : [];
  const dayLabel = formatInTimeZone(sydneyDayStart(today), TZ, "EEEE · d MMMM");

  const queue = (
    <QaQueueWorkspace inspectors={inspectors} canAssign={canAssign} qaPaySettings={settings?.qaPay} />
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="e-rise">
        <EEyebrow>{dayLabel}</EEyebrow>
        <h1 className="e-display-lg mt-2">Today&apos;s reviews.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      {unavailable ? (
        <div role="alert" className={`rounded-[var(--e-radius)] ${toneNoticeClass("problem")} px-4 py-3 text-sm`}>
          Some QA figures could not be loaded. <a href="/v2/qa" className="underline">Retry</a>
        </div>
      ) : null}
      <section aria-label="Today's figures" className="grid grid-cols-3 gap-2 sm:gap-4">
        <EStatCard label="To inspect" value={figure(toInspect)} delta={canAssign ? "team" : "yours"} deltaTone="neutral" />
        <EStatCard label="Rework open" value={figure(reworkOpen)} delta={canAssign ? "team-wide" : "yours"} deltaTone="neutral" />
        <EStatCard label="Done" value={figure(done)} delta="today" deltaTone={done ? "success" : "neutral"} />
      </section>

      <QaVisitOrder
        viewerId={session.user.id}
        canReorder={canAssign}
        // Inspectors plan their own day unless the office has set it; never
        // while an administrator is testing as them (the server refuses too).
        inspectorMayReorder={role === Role.QA_INSPECTOR && !session.impersonation}
        qaPaySettings={settings?.qaPay ?? null}
        todayKey={today}
      />

      {canAssign ? (
        <section id="office-queue-tools" aria-labelledby="office-queue-tools-heading" className="scroll-mt-20 space-y-4">
          <h2 id="office-queue-tools-heading" className="e-display-sm">Office queue tools</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Assign or move inspectors, set each inspector&apos;s visit order and pay. Administrators and operations managers only.
          </p>
          <QaDayPlanner inspectors={inspectors} />
          {queue}
        </section>
      ) : (
        <OperationsDisclosure
          title="All inspections"
          description="Search, filter by type or readiness, pick up open work and see submitted inspections. Changes nothing until you act."
          icon={<ListFilter className="h-4 w-4" />}
        >
          {queue}
        </OperationsDisclosure>
      )}
    </div>
  );
}
