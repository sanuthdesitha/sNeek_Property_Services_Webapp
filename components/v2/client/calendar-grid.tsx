"use client";

/**
 * Estate month-grid calendar — native v2 replacement for the legacy
 * PortalCalendar widget on the client calendar page. Month navigation,
 * status-coloured event chips that link to the job detail, and a legend.
 * Pure display over server-provided events; no fetches.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";

export type CalendarGridEvent = {
  id: string;
  /** yyyy-MM-dd in the portal timezone */
  dayKey: string;
  title: string;
  status: string;
  subtitle?: string | null;
  href: string;
};

const STATUS_COLOR: Record<string, string> = {
  UNASSIGNED: "hsl(var(--e-warning))",
  OFFERED: "hsl(var(--e-warning))",
  ASSIGNED: "hsl(var(--e-accent-portal))",
  EN_ROUTE: "hsl(var(--e-accent-portal))",
  IN_PROGRESS: "hsl(var(--e-info))",
  PAUSED: "hsl(var(--e-warning))",
  WAITING_CONTINUATION_APPROVAL: "hsl(var(--e-danger))",
  SUBMITTED: "hsl(var(--e-gold))",
  QA_REVIEW: "hsl(var(--e-gold))",
  COMPLETED: "hsl(var(--e-success))",
  INVOICED: "hsl(var(--e-muted-foreground))",
  CANCELLED: "hsl(var(--e-danger))",
};

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "Unassigned / awaiting", color: "hsl(var(--e-warning))" },
  { label: "Assigned", color: "hsl(var(--e-accent-portal))" },
  { label: "In progress", color: "hsl(var(--e-info))" },
  { label: "Submitted / review", color: "hsl(var(--e-gold))" },
  { label: "Completed", color: "hsl(var(--e-success))" },
  { label: "Invoiced", color: "hsl(var(--e-muted-foreground))" },
];

function titleCase(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EstateCalendarGrid({
  events,
  initialMonthKey,
}: {
  events: CalendarGridEvent[];
  /** yyyy-MM for the month to open on (defaults to the current month). */
  initialMonthKey?: string;
}) {
  const [month, setMonth] = useState(() =>
    startOfMonth(initialMonthKey ? new Date(`${initialMonthKey}-01T00:00:00`) : new Date())
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarGridEvent[]>();
    for (const event of events) {
      const list = map.get(event.dayKey);
      if (list) list.push(event);
      else map.set(event.dayKey, [event]);
    }
    return map;
  }, [events]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const todayKey = format(new Date(), "yyyy-MM-dd");

  return (
    <ECard>
      <ECardBody className="space-y-4 pt-5">
        <div className="flex items-center justify-between">
          <EButton
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((current) => subMonths(current, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </EButton>
          <p className="e-display-sm text-[1.0625rem]">{format(month, "MMMM yyyy")}</p>
          <div className="flex items-center gap-2">
            <EButton variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </EButton>
            <EButton
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => setMonth((current) => addMonths(current, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </EButton>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div key={label}>{label}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const inMonth = isSameMonth(day, month);
            const dayEvents = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[4.5rem] rounded-[var(--e-radius)] border p-1.5 text-left align-top sm:min-h-[5.5rem]",
                  inMonth
                    ? "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
                    : "border-transparent bg-[hsl(var(--e-surface-sunken))]",
                  isToday && "border-[hsl(var(--e-gold))]"
                )}
              >
                <p
                  className={cn(
                    "text-[0.75rem] leading-none",
                    inMonth ? "text-[hsl(var(--e-text-secondary))]" : "text-[hsl(var(--e-text-faint))]",
                    isToday && "font-bold text-[hsl(var(--e-gold-ink))]"
                  )}
                >
                  {format(day, "d")}
                </p>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((event) => {
                    const color = STATUS_COLOR[event.status] ?? "hsl(var(--e-accent-portal))";
                    return (
                      <Link
                        key={event.id}
                        href={event.href}
                        title={`${event.title}${event.subtitle ? ` · ${event.subtitle}` : ""} — ${titleCase(event.status)}`}
                        className="block truncate rounded-[3px] border-l-2 px-1 py-0.5 text-[0.625rem] font-medium leading-tight hover:opacity-80"
                        style={{
                          borderColor: color,
                          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
                        }}
                      >
                        {event.title}
                      </Link>
                    );
                  })}
                  {dayEvents.length > 3 ? (
                    <p className="px-1 text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                      +{dayEvents.length - 3} more
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[hsl(var(--e-border))] pt-3">
          {LEGEND.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </ECardBody>
    </ECard>
  );
}
