"use client";

/**
 * Month view (kept from the previous calendar): a Monday-first grid with up
 * to three jobs per day and "+N more", which opens THAT day in Day view.
 * Laundry pickups and drop-offs show under the jobs when the toggle is on.
 * Each day cell accepts a dropped chip to move the job to that day (cleaners
 * unchanged). Below `sm` the month is a readable day-by-day agenda instead.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DropPoint } from "@/lib/calendar/drop";
import { jobsOnDay } from "@/lib/calendar/lanes";
import { dayOfMonth, monthGridCells } from "@/lib/calendar/range";
import type { CalendarResponse } from "@/lib/calendar/types";
import { CalendarAgenda } from "./calendar-agenda";
import { CalendarJobChip, type ChipActions } from "./calendar-job-chip";
import { laundryHref } from "./calendar-lane-parts";
import { DropCell, type GridDisplay } from "./calendar-week-grid";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VISIBLE_JOBS = 3;
const VISIBLE_LAUNDRY = 2;

type MonthProps = { data: CalendarResponse; cursor: string; actions: ChipActions; display: GridDisplay; onOpenDay: (day: string) => void };

export function CalendarMonthGrid({ data, cursor, actions, display, onOpenDay }: MonthProps) {
  const cells = monthGridCells(cursor);
  return (
    <>
      <div className="hidden p-2 sm:block sm:p-3">
        <div className="grid grid-cols-7" aria-hidden>
          {WEEKDAYS.map((weekday) => (
            <p key={weekday} className="px-2 py-2 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]">{weekday}</p>
          ))}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {cells.map((day, index) => {
            if (!day) return <div key={`blank-${index}`} className="min-h-[112px] border-b border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]" />;
            const jobs = jobsOnDay(data, day);
            const laundry = display.showLaundry ? data.laundry?.[day]?.items ?? [] : [];
            const overflow = Math.max(0, jobs.length - VISIBLE_JOBS);
            // The month has no rows: a drop changes only the day, so every cell is a plain day target.
            const point: DropPoint = { lane: "unassigned", rowId: null, day };
            return (
              <DropCell key={day} point={point} drag={display.drag} today={day === data.today} label={`${day}${day === data.today ? ", today" : ""}`}
                className={cn("min-h-[112px]", day === data.today ? "bg-[hsl(var(--e-gold-soft))] ring-2 ring-inset ring-[hsl(var(--e-gold))]" : "bg-[hsl(var(--e-surface))]")}>
                <p className={cn("e-numeral px-1 text-[0.8125rem]", day === data.today ? "font-semibold text-[hsl(var(--e-gold-ink))]" : "text-[hsl(var(--e-muted-foreground))]")}>
                  {dayOfMonth(day)}
                </p>
                {jobs.slice(0, VISIBLE_JOBS).map((job) => (
                  <CalendarJobChip key={job.id} job={job} source={point} actions={actions} showArrival={false} showCleaner
                    pending={display.pendingIds.has(job.id)} dragging={display.drag?.job.id === job.id} />
                ))}
                {overflow > 0 ? (
                  <button type="button" onClick={() => onOpenDay(day)} className="px-1 text-left text-[0.6875rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline">
                    +{overflow} more
                  </button>
                ) : null}
                {laundry.slice(0, VISIBLE_LAUNDRY).map((item) => (
                  <Link key={item.id} href={laundryHref(day)} title={`Laundry ${item.kind === "pickup" ? "pickup" : "drop-off"} · ${item.propertyName}`}
                    className="block truncate rounded-[6px] border border-dashed border-[hsl(var(--e-gold)/0.6)] bg-[hsl(var(--e-gold-soft))] px-1.5 py-0.5 text-[0.6875rem] text-[hsl(var(--e-gold-ink))]">
                    {item.kind === "pickup" ? "Pickup" : "Drop-off"} · {item.propertyName}
                  </Link>
                ))}
                {laundry.length > VISIBLE_LAUNDRY ? (
                  <Link href={laundryHref(day)} className="px-1 text-[0.625rem] text-[hsl(var(--e-text-faint))] hover:underline">+{laundry.length - VISIBLE_LAUNDRY} laundry</Link>
                ) : null}
              </DropCell>
            );
          })}
        </div>
      </div>
      <div className="sm:hidden">
        <CalendarAgenda data={data} actions={actions} display={display} emptyText="No jobs this month match the current filters." />
      </div>
    </>
  );
}
