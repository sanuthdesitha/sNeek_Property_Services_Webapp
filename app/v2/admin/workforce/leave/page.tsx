import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { loadTeamLeave } from "@/lib/workforce/team-leave";
import { addDays, isDayKey, leaveWindow, mondayOf, type LeaveWindow } from "@/lib/workforce/team-leave-model";
import { loadWorkforceAreaSummary } from "@/lib/workforce/area-counts";
import { WorkforceArea } from "@/components/v2/admin/workforce/workforce-area";
import { TeamLeaveView, type LeaveViewKey } from "@/components/v2/admin/workforce/team-leave-view";

export const metadata = { title: "Leave and availability · Workforce" };
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function windowFor(view: LeaveViewKey, from: string | undefined, today: string): LeaveWindow {
  if (view === "next14") return leaveWindow(today, 14);
  if (view === "past") return leaveWindow(addDays(today, -30), 30);
  if (view === "month") {
    const start = `${today.slice(0, 7)}-01`;
    const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const length = Math.round((Date.parse(`${nextMonth}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
    return leaveWindow(start, length);
  }
  return leaveWindow(mondayOf(isDayKey(from) ? from : today), 14);
}

/**
 * Workforce › Leave and availability (new team view). Leave was added one
 * person at a time on their page; this shows everyone's by day. Sydney days.
 */
export default async function WorkforceLeavePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const today = sydneyTodayKey();
  const rawView = first(searchParams?.view);
  const view: LeaveViewKey = rawView === "next14" || rawView === "month" || rawView === "past" ? rawView : "fortnight";
  const window = windowFor(view, first(searchParams?.from), today);
  const [data, summary] = await Promise.all([loadTeamLeave(window.start, window.end), loadWorkforceAreaSummary()]);

  return (
    <WorkforceArea active="leave" summary={summary}>
      {data.status === "failed" ? (
        <div role="alert" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
          <p className="font-[600]">Leave could not be loaded.</p>
          <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing is shown rather than an empty calendar. Reload the page to try again.</p>
        </div>
      ) : (
        <TeamLeaveView
          people={data.people}
          window={window}
          view={view}
          previousHref={`/v2/admin/workforce/leave?from=${addDays(window.start, -14)}`}
          nextHref={`/v2/admin/workforce/leave?from=${addDays(window.start, 14)}`}
          todayKey={today}
          canRecord
        />
      )}
    </WorkforceArea>
  );
}
