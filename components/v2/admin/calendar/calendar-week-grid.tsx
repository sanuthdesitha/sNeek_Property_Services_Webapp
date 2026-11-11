"use client";

/**
 * Week view on wide screens: a resource grid. First column is the row
 * (cleaner with hours this week, or property), then seven day columns with
 * today highlighted. Cleaners mode starts with the "Unassigned" lane; a
 * "Laundry runs" row closes the grid when that toggle is on. Every cell is a
 * drop target; the grid scrolls inside its card, never the page.
 */
import { cn } from "@/lib/utils";
import type { DropPoint } from "@/lib/calendar/drop";
import type { CalendarLane } from "@/lib/calendar/lanes";
import { shortDayLabel } from "@/lib/calendar/range";
import type { CalendarResponse } from "@/lib/calendar/types";
import { CalendarJobChip, type ChipActions } from "./calendar-job-chip";
import { LaneLabel, LaundryCell, RosterNote } from "./calendar-lane-parts";
import type { DragState } from "./use-chip-drag";

export type GridDisplay = {
  showArrivals: boolean;
  showLaundry: boolean;
  pendingIds: ReadonlySet<string>;
  drag: DragState;
};

const CELL = "flex min-h-[92px] min-w-0 flex-col gap-1 border-b border-r border-[hsl(var(--e-border))] p-1.5";

function isOver(drag: DragState, point: DropPoint): boolean {
  return Boolean(drag?.over && drag.over.day === point.day && drag.over.lane === point.lane && drag.over.rowId === point.rowId);
}

export function DropCell({ point, drag, className, children, label, today = false }: { point: DropPoint; drag: DragState; className?: string; children?: React.ReactNode; label: string; today?: boolean }) {
  return (
    <div
      role="cell"
      data-calendar-today={today || undefined}
      aria-label={label}
      data-drop-day={point.day}
      data-drop-lane={point.lane}
      data-drop-row={point.rowId ?? ""}
      className={cn(CELL, className, isOver(drag, point) && "bg-[hsl(var(--e-primary-soft))] outline outline-2 -outline-offset-2 outline-[hsl(var(--e-primary))]")}
    >
      {children}
    </div>
  );
}

export function CalendarWeekGrid({ data, lanes, actions, display }: { data: CalendarResponse; lanes: CalendarLane[]; actions: ChipActions; display: GridDisplay }) {
  const days = data.range.days;
  const columns = { gridTemplateColumns: `130px repeat(${days.length}, minmax(0, 1fr))` };
  return (
    <div className="overflow-x-auto" role="region" aria-label="Week by row" tabIndex={0}>
      <div role="table" className="grid min-w-[880px] text-[0.8125rem]" style={columns}>
        <div role="row" className="contents">
          <div role="columnheader" className="border-b border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1.5">
            <span className="sr-only">Row</span>
          </div>
          {days.map((day) => (
            <div
              key={day}
              role="columnheader"
              className={cn(
                "border-b border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1.5 text-[0.75rem] font-[600]",
                day === data.today && "text-[hsl(var(--e-primary))]",
              )}
            >
              {shortDayLabel(day)}{day === data.today ? " · today" : ""}
            </div>
          ))}
        </div>

        {lanes.map((lane) => (
          <div role="row" key={lane.key} className="contents">
            <div role="rowheader" className={cn(CELL, "bg-[hsl(var(--e-surface))]")}>
              <LaneLabel lane={lane} period="this week" />
            </div>
            {days.map((day) => {
              const point: DropPoint = { lane: lane.lane, rowId: lane.rowId, day };
              const jobs = lane.jobsByDay.get(day) ?? [];
              const roster = lane.row?.unavailable[day];
              return (
                <DropCell
                  key={day}
                  point={point}
                  drag={display.drag}
                  label={`${lane.label}, ${shortDayLabel(day)}`}
                  className={cn(day === data.today && "bg-[hsl(var(--e-primary-soft)/0.35)]", roster && jobs.length === 0 && "bg-[hsl(var(--e-surface-raised))]")}
                >
                  {roster ? <RosterNote reason={roster} /> : null}
                  {jobs.map((job) => (
                    <CalendarJobChip
                      key={job.id}
                      job={job}
                      source={point}
                      actions={actions}
                      showArrival={display.showArrivals}
                      showCleaner={lane.lane === "property"}
                      pending={display.pendingIds.has(job.id)}
                      dragging={display.drag?.job.id === job.id}
                    />
                  ))}
                </DropCell>
              );
            })}
          </div>
        ))}

        {display.showLaundry && data.laundry ? (
          <div role="row" className="contents">
            <div role="rowheader" className={cn(CELL, "min-h-0 font-[600] text-[hsl(var(--e-gold-ink))]")}>Laundry runs</div>
            {days.map((day) => (
              <div key={day} role="cell" className={cn(CELL, "min-h-0")}>
                <LaundryCell day={day} counts={data.laundry?.[day]} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
