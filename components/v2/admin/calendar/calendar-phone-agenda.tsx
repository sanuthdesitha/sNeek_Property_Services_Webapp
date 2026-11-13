"use client";

/**
 * Phones only (below 640px): the day agenda as drawn on the board "Admin
 * phone: Calendar". Each day lists its work grouped by row (Unassigned first,
 * then each cleaner, or each property in "Rows: properties"), one card per
 * group, then the laundry runs. A job card shows its time, property, status in
 * words, type and hours, the guest arrival, and "Move or reassign" (dragging
 * is not offered on a phone) beside the job's usual menu.
 *
 * It reads the same lanes, actions and pending set as the other views, so the
 * move goes through the same check, confirmation and save as a drop.
 */
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EToneCard } from "@/components/v2/ui/tone-band";
import type { DropPoint } from "@/lib/calendar/drop";
import type { CalendarLane } from "@/lib/calendar/lanes";
import { CHIP_CATEGORY_LABEL, chipCategory, formatHours, type ChipCategory } from "@/lib/calendar/presentation";
import { longDayLabel } from "@/lib/calendar/range";
import type { CalendarJob, CalendarResponse } from "@/lib/calendar/types";
import { chipDescription, chipMenuItems, cleanerSummary, type ChipActions } from "./calendar-job-chip";
import { LaundryCell, RosterNote } from "./calendar-lane-parts";
import type { GridDisplay } from "./calendar-week-grid";

const CATEGORY_TONE: Record<ChipCategory, EPillTone> = {
  planned: "info",
  offered: "info",
  done: "ok",
  late: "warn",
  onSite: "ok",
  unassigned: "bad",
  skipped: "neutral",
  cancelled: "neutral",
};

function jobTypeText(job: CalendarJob): string {
  const words = job.jobType.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type JobCardProps = {
  job: CalendarJob;
  source: DropPoint;
  actions: ChipActions;
  display: GridDisplay;
  showCleaner: boolean;
};

function PhoneJobRow({ job, source, actions, display, showCleaner }: JobCardProps) {
  const pending = display.pendingIds.has(job.id);
  const category = chipCategory(job);
  const movable = !job.moveBlock && !actions.readOnly && !pending;
  const facts = [jobTypeText(job), job.hours !== null ? formatHours(job.hours) : null].filter(Boolean).join(" · ");
  return (
    <li data-job-chip={job.id} data-pending={pending || undefined} className={cn("flex gap-3 px-3.5 py-3", pending && "opacity-70")}>
      <span className="e-tnum w-11 shrink-0 pt-0.5 text-[0.875rem] font-[650]">{job.startTime ?? "—"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            aria-label={`${chipDescription(job)}. Open preview`}
            onClick={() => actions.onOpen(job)}
            className={cn(
              "min-w-0 text-left text-[0.9375rem] font-[600] [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              category === "skipped" && "line-through",
            )}
          >
            {job.propertyName}
          </button>
          <EPill tone={CATEGORY_TONE[category]} className="shrink-0">{CHIP_CATEGORY_LABEL[category]}</EPill>
        </div>
        <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{facts}</p>
        {showCleaner && job.cleaners.length > 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{cleanerSummary(job)}</p> : null}
        {display.showArrivals && job.guestArrival ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Guest in {job.guestArrival.time ?? "(time not set)"}</p>
        ) : null}
        {pending ? (
          <p role="status" className="mt-1 flex items-center gap-1 text-[0.8125rem]"><Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Move pending…</p>
        ) : null}
        {job.moveBlock && !pending ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.moveBlock}</p> : null}
        <div className="mt-2 flex items-center gap-2">
          {movable ? (
            <EButton variant="outline" size="sm" onClick={() => actions.onMove(job, source)}>Move or reassign</EButton>
          ) : null}
          <ERowMenu label={`Actions for ${job.propertyName}`} items={chipMenuItems(job, source, actions, pending)} />
        </div>
      </div>
    </li>
  );
}

function laneHeading(lane: CalendarLane, day: string, count: number) {
  if (lane.lane === "unassigned") return <span className="text-[0.875rem] font-[650]">Unassigned · <span className="e-tnum">{count}</span></span>;
  const row = lane.row;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[0.875rem] font-[650]">
      <span className="[overflow-wrap:anywhere]">{lane.label}{row && !row.active ? <span className="font-[400] text-[hsl(var(--e-muted-foreground))]"> (inactive)</span> : null}</span>
      {row && lane.lane === "cleaner" ? <span className="text-[0.75rem] font-[400] text-[hsl(var(--e-muted-foreground))]">· {formatHours(row.hours)} this week</span> : null}
      {row?.unavailable[day] ? <RosterNote reason={row.unavailable[day]} /> : null}
    </span>
  );
}

type AgendaProps = {
  data: CalendarResponse;
  lanes: CalendarLane[];
  /** The days to list (one for Day, seven for Week). */
  days: string[];
  actions: ChipActions;
  display: GridDisplay;
};

export function CalendarPhoneAgenda({ data, lanes, days, actions, display }: AgendaProps) {
  const single = days.length === 1;
  return (
    <div className="space-y-4" data-calendar-phone-agenda="">
      {days.map((day) => {
        const groups = lanes.filter((lane) => (lane.jobsByDay.get(day) ?? []).length > 0);
        const laundry = display.showLaundry && data.laundry ? data.laundry[day] : undefined;
        const hasLaundry = Boolean(laundry && (laundry.pickups > 0 || laundry.drops > 0));
        return (
          <section key={day} aria-label={longDayLabel(day)} className="space-y-2.5">
            {single ? null : (
              <h2 className="text-[0.8125rem] font-[650]">
                {longDayLabel(day)}
                {day === data.today ? <span className="ml-1.5 text-[hsl(var(--e-primary))]">· today</span> : null}
              </h2>
            )}
            {groups.length === 0 && !hasLaundry ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No jobs.</p> : null}
            {groups.map((lane) => {
              const jobs = lane.jobsByDay.get(day) ?? [];
              const point: DropPoint = { lane: lane.lane, rowId: lane.rowId, day };
              return (
                <EToneCard
                  key={lane.key}
                  tone={lane.lane === "unassigned" ? "problem" : null}
                  pill={lane.lane === "unassigned" ? "No cleaner" : undefined}
                  header={laneHeading(lane, day, jobs.length)}
                  headerClassName={lane.lane === "unassigned" ? undefined : "pb-2.5 border-b border-[hsl(var(--e-border))]"}
                  bodyClassName="p-0"
                >
                  <ul className="divide-y divide-[hsl(var(--e-border))]">
                    {jobs.map((job) => (
                      <PhoneJobRow key={job.id} job={job} source={point} actions={actions} display={display} showCleaner={lane.lane === "property"} />
                    ))}
                  </ul>
                </EToneCard>
              );
            })}
            {hasLaundry ? (
              <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5">
                <p className="mb-1.5 text-[0.875rem] font-[650]">Laundry runs</p>
                <LaundryCell day={day} counts={laundry} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
