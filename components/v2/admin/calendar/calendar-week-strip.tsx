"use client";

/**
 * Phones only: the week strip above the day agenda. Seven day buttons
 * (Monday first) with the day's job count and a "!" when the loaded calendar
 * shows unassigned work or a cleaner clash that day. Tapping a day opens that
 * day. A deliberate carousel: it scrolls sideways on its own if it must.
 */
import { cn } from "@/lib/utils";
import { dayOfMonth, weekdayShort } from "@/lib/calendar/range";
import type { CalendarResponse } from "@/lib/calendar/types";
import { weekStripDay, weekStripDays } from "./calendar-phone-model";

type WeekStripProps = {
  cursor: string;
  today: string;
  /** The day being shown (Day view), or null when a longer range is shown. */
  selected: string | null;
  data: CalendarResponse | null;
  onPick: (day: string) => void;
};

function dayName(day: string, today: string): string {
  return day === today ? "Today" : weekdayShort(day);
}

export function CalendarWeekStrip({ cursor, today, selected, data, onPick }: WeekStripProps) {
  const days = weekStripDays(cursor);
  return (
    <nav aria-label="Week" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] sm:hidden">
      <ul className="grid min-w-max grid-cols-7 gap-1">
        {days.map((day) => {
          const facts = weekStripDay(data, day);
          const flagged = facts.unassigned > 0 || facts.clash;
          const flags = [
            facts.unassigned > 0 ? `${facts.unassigned} without a cleaner` : null,
            facts.clash ? "a cleaner clash" : null,
          ].filter(Boolean).join(", ");
          const count = facts.jobs === null ? "jobs not loaded" : `${facts.jobs} job${facts.jobs === 1 ? "" : "s"}`;
          const current = selected === day;
          return (
            <li key={day}>
              <button
                type="button"
                aria-current={current ? "date" : undefined}
                aria-label={`${dayName(day, today)} ${dayOfMonth(day)}: ${count}${flags ? `, ${flags}` : ""}`}
                onClick={() => onPick(day)}
                className={cn(
                  "flex min-h-[3.5rem] w-[2.9rem] flex-col items-center justify-center gap-0.5 rounded-[10px] border text-center",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                  current
                    ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))]",
                )}
              >
                <span className="text-[0.6875rem] font-[500] opacity-80">{dayName(day, today)}</span>
                <span className="e-tnum text-[0.9375rem] font-[650] leading-none">{dayOfMonth(day)}</span>
                <span aria-hidden className="e-tnum text-[0.6875rem] leading-none">
                  {facts.jobs ?? "–"}
                  {flagged ? <b className={cn("ml-0.5 font-[700]", current ? "" : "text-[hsl(var(--e-danger))]")}>!</b> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
