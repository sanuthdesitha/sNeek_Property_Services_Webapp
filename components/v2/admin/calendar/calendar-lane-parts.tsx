"use client";

/**
 * Pieces shared by the week grid, the day view and the phone lists: the row
 * label ("Jane C. · 31 h this week"), the roster cell ("Not rostered") and the
 * laundry-runs cell linking to the Laundry page for that day.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/calendar/presentation";
import type { CalendarLane } from "@/lib/calendar/lanes";
import type { CalendarLaundryDay } from "@/lib/calendar/types";
import { unavailabilityKind } from "@/lib/accounts/leave-rules";

export function laundryHref(day: string): string {
  return `/v2/admin/laundry?date=${day}`;
}

/**
 * A day with one laundry run opens that run's full page (2026-11-14); a day
 * with several opens the Laundry Pipeline on that day.
 */
export function laundryCellHref(day: string, counts: CalendarLaundryDay): string {
  const runIds = new Set(counts.items.map((item) => item.id.replace(/-(pickup|drop)$/, "")));
  if (runIds.size === 1) return `/v2/admin/laundry/runs/${encodeURIComponent(Array.from(runIds)[0])}`;
  return laundryHref(day);
}

export function laundryText(counts: CalendarLaundryDay): string {
  const parts: string[] = [];
  if (counts.pickups > 0) parts.push(`Pickup ×${counts.pickups}`);
  if (counts.drops > 0) parts.push(`Drop ×${counts.drops}`);
  return parts.join(" · ");
}

export function laundryTitle(counts: CalendarLaundryDay): string {
  return counts.items.map((item) => `${item.kind === "pickup" ? "Pickup" : "Drop-off"} · ${item.propertyName}`).join("\n");
}

export function LaundryCell({ day, counts }: { day: string; counts: CalendarLaundryDay | undefined }) {
  if (!counts || (counts.pickups === 0 && counts.drops === 0)) return null;
  return (
    <Link
      href={laundryCellHref(day, counts)}
      title={laundryTitle(counts)}
      className="block rounded-[6px] border border-[hsl(var(--e-gold)/0.45)] bg-[hsl(var(--e-gold-soft))] px-1.5 py-1 text-[0.71875rem] text-[hsl(var(--e-gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
    >
      {laundryText(counts)}
      <span className="sr-only"> on {day}, open Laundry for this day</span>
    </Link>
  );
}

/** "this week" / "this day" / "in range" for the hours line. */
export function LaneLabel({ lane, period }: { lane: CalendarLane; period: string }) {
  const row = lane.row;
  return (
    <div className="flex min-w-0 flex-col">
      <span className={cn("truncate font-[600]", lane.lane === "unassigned" && "text-[hsl(var(--e-danger))]")}>
        {lane.label}
        {row && !row.active ? <span className="font-[400] text-[hsl(var(--e-muted-foreground))]"> (inactive)</span> : null}
      </span>
      <span className="truncate text-[0.75rem] font-[400] text-[hsl(var(--e-muted-foreground))]">
        {lane.lane === "unassigned"
          ? `${lane.jobCount} job${lane.jobCount === 1 ? "" : "s"}`
          : row
            ? `${formatHours(row.hours)} ${period}${row.jobsWithoutHours > 0 ? ` · ${row.jobsWithoutHours} without hours` : ""}`
            : null}
      </span>
    </div>
  );
}

/**
 * The unavailability lane's note: "Leave" / "Day off" for a recorded leave
 * record (its full reason in the title and for screen readers), else
 * "Not rostered" for a day outside the saved availability.
 */
export function RosterNote({ reason }: { reason: string }) {
  const kind = unavailabilityKind(reason);
  const label = kind === "leave" ? "Leave" : kind === "day-off" ? "Day off" : "Not rostered";
  const title = kind === "roster" ? `${reason} (saved availability)` : reason;
  return (
    <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]" title={title}>
      {label}
      <span className="sr-only">: {title}</span>
    </span>
  );
}
