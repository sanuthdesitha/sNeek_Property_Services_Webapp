"use client";

/**
 * Phones and narrow windows: Week and Day as a day-by-day list grouped by row
 * (Unassigned first, then each cleaner or property with work that day). Rows
 * with nothing that day are left out. Jobs move with "Move or reassign…" from
 * the chip menu; drag is not offered on touch.
 */
import type { DropPoint } from "@/lib/calendar/drop";
import type { CalendarLane } from "@/lib/calendar/lanes";
import { longDayLabel } from "@/lib/calendar/range";
import type { CalendarResponse } from "@/lib/calendar/types";
import { CalendarJobChip, type ChipActions } from "./calendar-job-chip";
import { LaundryCell, RosterNote } from "./calendar-lane-parts";
import type { GridDisplay } from "./calendar-week-grid";

export function CalendarDayList({ data, lanes, actions, display }: { data: CalendarResponse; lanes: CalendarLane[]; actions: ChipActions; display: GridDisplay }) {
  return (
    <div className="divide-y divide-[hsl(var(--e-border))]">
      {data.range.days.map((day) => {
        const groups = lanes.filter((lane) => (lane.jobsByDay.get(day) ?? []).length > 0);
        const notRostered = lanes.filter((lane) => lane.row?.unavailable[day] && (lane.jobsByDay.get(day) ?? []).length > 0);
        return (
          <section key={day} aria-label={longDayLabel(day)}>
            <h2 className="flex items-center justify-between bg-[hsl(var(--e-surface-raised))] px-4 py-2 text-[0.8125rem] font-[600]">
              <span>
                {longDayLabel(day)}
                {day === data.today ? <span className="ml-2 text-[hsl(var(--e-primary))]">· today</span> : null}
              </span>
            </h2>
            <div className="space-y-3 p-3">
              {groups.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No jobs.</p> : null}
              {groups.map((lane) => {
                const point: DropPoint = { lane: lane.lane, rowId: lane.rowId, day };
                return (
                  <div key={lane.key} className="space-y-1.5">
                    <p className={lane.lane === "unassigned" ? "text-[0.75rem] font-[600] text-[hsl(var(--e-danger))]" : "text-[0.75rem] font-[600]"}>
                      {lane.label}
                      {notRostered.includes(lane) && lane.row ? <span className="ml-2 font-[400]"><RosterNote reason={lane.row.unavailable[day]} /></span> : null}
                    </p>
                    {(lane.jobsByDay.get(day) ?? []).map((job) => (
                      <CalendarJobChip key={job.id} job={job} source={point} actions={actions} showArrival={display.showArrivals}
                        showCleaner={lane.lane === "property"} pending={display.pendingIds.has(job.id)} />
                    ))}
                  </div>
                );
              })}
              {display.showLaundry && data.laundry ? <LaundryCell day={day} counts={data.laundry[day]} /> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
