import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, isAfter, isBefore, startOfDay } from "date-fns";
import type { PayrollPeriodSettings } from "@/lib/settings";

export interface ResolvedPayPeriod {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
  nextPayoutDate: string;
  label: string;
}

function parseLocalDate(value: string | undefined, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfDay(fallback);
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? startOfDay(fallback) : startOfDay(parsed);
}

function addInterval(date: Date, interval: PayrollPeriodSettings["interval"], count = 1) {
  if (interval === "MONTHLY") return addMonths(date, count);
  if (interval === "FORTNIGHTLY") return addWeeks(date, 2 * count);
  return addWeeks(date, count);
}

export function resolvePayPeriod(
  settings: PayrollPeriodSettings,
  referenceDate = new Date()
): ResolvedPayPeriod {
  const today = startOfDay(referenceDate);
  let start = parseLocalDate(settings.anchorDate, today);
  let endExclusive = addInterval(start, settings.interval);

  if (isBefore(today, start)) {
    while (isBefore(today, start)) {
      endExclusive = start;
      start = addInterval(start, settings.interval, -1);
    }
  } else {
    while (!isBefore(today, endExclusive)) {
      start = endExclusive;
      endExclusive = addInterval(start, settings.interval);
    }
  }

  const end = addDays(endExclusive, -1);
  const payoutDate = addDays(end, Math.max(0, settings.payoutDelayDays));
  const daysLeft = Math.max(0, differenceInCalendarDays(end, today));
  const periodLabel = `${format(start, "dd MMM yyyy")} - ${format(end, "dd MMM yyyy")}`;

  return {
    start,
    end,
    startDate: format(start, "yyyy-MM-dd"),
    endDate: format(end, "yyyy-MM-dd"),
    nextPayoutDate: format(isAfter(payoutDate, end) ? payoutDate : end, "yyyy-MM-dd"),
    label: `${periodLabel}${daysLeft > 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}`,
  };
}
