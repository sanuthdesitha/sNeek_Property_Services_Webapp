"use client";

/**
 * Shared date-scope control for the Estate laundry boards (Queue / Runs /
 * Tracking). Compact chip row — Today / Tomorrow / This week / Custom — plus
 * two native date inputs when Custom is active. The pure range resolver maps a
 * scope onto the { start, days } window the /api/laundry/week feed accepts, so
 * no board needs its own date maths.
 */
import * as React from "react";
import { addDays, differenceInCalendarDays, format, startOfDay, startOfWeek } from "date-fns";
import { cn } from "@/lib/utils";

export type LaundryDateScope = "today" | "tomorrow" | "week" | "custom";

export type LaundryDateRange = {
  /** Inclusive range start (start of day). */
  start: Date;
  /** Number of days covered — feeds the week API's `days` param. */
  days: number;
  /** Exclusive range end (start + days). */
  endExclusive: Date;
};

const SCOPES: { id: LaundryDateScope; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "custom", label: "Custom" },
];

function parseDayKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Pure scope → range resolver. Custom falls back to today when the inputs are
 * empty/invalid; a reversed custom range is normalised to a single day at
 * `from`. "This week" is Monday-anchored to match the rest of the platform.
 */
export function resolveLaundryDateRange(
  scope: LaundryDateScope,
  customFrom: string,
  customTo: string,
  now: Date = new Date()
): LaundryDateRange {
  const today = startOfDay(now);
  if (scope === "tomorrow") {
    const start = addDays(today, 1);
    return { start, days: 1, endExclusive: addDays(start, 1) };
  }
  if (scope === "week") {
    const start = startOfWeek(today, { weekStartsOn: 1 });
    return { start, days: 7, endExclusive: addDays(start, 7) };
  }
  if (scope === "custom") {
    const from = parseDayKey(customFrom) ?? today;
    const to = parseDayKey(customTo) ?? from;
    const days = Math.max(1, differenceInCalendarDays(to, from) + 1);
    return { start: from, days, endExclusive: addDays(from, days) };
  }
  return { start: today, days: 1, endExclusive: addDays(today, 1) };
}

const DATE_INPUT_CLS =
  "h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function LaundryDateScopeControl({
  scope,
  customFrom,
  customTo,
  onScopeChange,
  onCustomFromChange,
  onCustomToChange,
  className,
}: {
  scope: LaundryDateScope;
  customFrom: string;
  customTo: string;
  onScopeChange: (scope: LaundryDateScope) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {SCOPES.map((option) => {
          const active = scope === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                if (option.id === "custom" && !customFrom) {
                  // Seed a sensible default so Custom never means "empty range".
                  const today = format(startOfDay(new Date()), "yyyy-MM-dd");
                  onCustomFromChange(today);
                  if (!customTo) onCustomToChange(today);
                }
                onScopeChange(option.id);
              }}
              className={cn(
                "rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-[550] tracking-[0.02em] transition-colors duration-[160ms]",
                active
                  ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                  : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-gold))] hover:text-[hsl(var(--e-foreground))]"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {scope === "custom" ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFromChange(e.target.value)}
            aria-label="Custom range start"
            className={DATE_INPUT_CLS}
          />
          <span>–</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomToChange(e.target.value)}
            aria-label="Custom range end"
            className={DATE_INPUT_CLS}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Small state hook so each board wires the control with one line. */
export function useLaundryDateScope(initialScope: LaundryDateScope = "today") {
  const [scope, setScope] = React.useState<LaundryDateScope>(initialScope);
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const range = React.useMemo(
    () => resolveLaundryDateRange(scope, customFrom, customTo),
    [scope, customFrom, customTo]
  );
  const control = (
    <LaundryDateScopeControl
      scope={scope}
      customFrom={customFrom}
      customTo={customTo}
      onScopeChange={setScope}
      onCustomFromChange={setCustomFrom}
      onCustomToChange={setCustomTo}
    />
  );
  return { scope, range, control };
}
