"use client";

/**
 * Day view on wide screens: the same rows as the week (Unassigned, cleaners or
 * properties) across the hours of one day. Jobs without a start time sit in a
 * "No time" column. A row's hour track is one drop target: dropping a chip on
 * another cleaner's row reassigns it, and dropping it at another hour proposes
 * a new start (snapped to `TIME_DROP_STEP_MINUTES`, length kept). Both go
 * through the server's move check and confirmation before anything is saved.
 */
import { cn } from "@/lib/utils";
import { axisBounds, layoutDayRow } from "@/lib/calendar/day-axis";
import type { DropPoint } from "@/lib/calendar/drop";
import type { CalendarLane } from "@/lib/calendar/lanes";
import { longDayLabel } from "@/lib/calendar/range";
import type { CalendarResponse } from "@/lib/calendar/types";
import { CalendarJobChip, type ChipActions } from "./calendar-job-chip";
import { LaneLabel, LaundryCell, RosterNote } from "./calendar-lane-parts";
import { DropCell, type GridDisplay } from "./calendar-week-grid";

const SLOT_HEIGHT = 46;
const HOUR_WIDTH = 72;

export function CalendarDayView({ data, lanes, actions, display }: { data: CalendarResponse; lanes: CalendarLane[]; actions: ChipActions; display: GridDisplay }) {
  const day = data.range.start;
  const bounds = axisBounds(data.jobs);
  const hours = Array.from({ length: bounds.endHour - bounds.startHour }, (_, index) => bounds.startHour + index);
  const trackWidth = hours.length * HOUR_WIDTH;
  const toPx = (minutes: number) => ((minutes - bounds.startHour * 60) / 60) * HOUR_WIDTH;
  const columns = { gridTemplateColumns: `130px 120px ${trackWidth}px` };

  return (
    <div className="overflow-x-auto" role="region" aria-label={`${longDayLabel(day)} by hour`} tabIndex={0}>
      <div role="table" className="grid text-[0.8125rem]" style={columns}>
        <div role="row" className="contents">
          <div role="columnheader" className="border-b border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1.5"><span className="sr-only">Row</span></div>
          <div role="columnheader" className="border-b border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1.5 text-[0.75rem] font-[600]">No time</div>
          <div role="columnheader" className="relative flex border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] text-[0.75rem] font-[600]">
            {hours.map((hour) => (
              <span key={hour} className="border-r border-[hsl(var(--e-border))] p-1.5" style={{ width: HOUR_WIDTH }}>{String(hour).padStart(2, "0")}:00</span>
            ))}
          </div>
        </div>

        {lanes.map((lane) => {
          const point: DropPoint = { lane: lane.lane, rowId: lane.rowId, day };
          const layout = layoutDayRow(lane.jobsByDay.get(day) ?? []);
          const roster = lane.row?.unavailable[day];
          const chip = (job: (typeof layout.untimed)[number]) => (
            <CalendarJobChip key={job.id} job={job} source={point} actions={actions} showArrival={display.showArrivals}
              showCleaner={lane.lane === "property"} pending={display.pendingIds.has(job.id)} dragging={display.drag?.job.id === job.id} />
          );
          return (
            <div role="row" key={lane.key} className="contents">
              <div role="rowheader" className="min-w-0 border-b border-r border-[hsl(var(--e-border))] p-1.5"><LaneLabel lane={lane} period="this day" /></div>
              <div role="cell" className="flex min-w-0 flex-col gap-1 border-b border-r border-[hsl(var(--e-border))] p-1.5">
                {roster ? <RosterNote reason={roster} /> : null}
                {layout.untimed.map(chip)}
              </div>
              <DropCell point={point} drag={display.drag} label={`${lane.label}, ${longDayLabel(day)}`} className={cn("relative border-r-0 p-0")}
                axis={{ startMinute: bounds.startHour * 60, pxPerHour: HOUR_WIDTH }}>
                <div className="relative" style={{ height: layout.slots * SLOT_HEIGHT + 8 }}>
                  {layout.placed.map((item) => (
                    <div
                      key={item.job.id}
                      className={cn("absolute", item.openEnded && "[&>div]:border-r-0")}
                      style={{ left: toPx(item.start) + 2, width: Math.max(toPx(item.end) - toPx(item.start) - 4, 64), top: item.slot * SLOT_HEIGHT + 4 }}
                      title={item.openEnded ? "No finish time set: drawn one hour wide" : undefined}
                    >
                      {chip(item.job)}
                    </div>
                  ))}
                </div>
              </DropCell>
            </div>
          );
        })}

        {display.showLaundry && data.laundry ? (
          <div role="row" className="contents">
            <div role="rowheader" className="border-r border-[hsl(var(--e-border))] p-1.5 font-[600] text-[hsl(var(--e-gold-ink))]">Laundry runs</div>
            <div role="cell" className="col-span-2 p-1.5"><LaundryCell day={day} counts={data.laundry[day]} /></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
