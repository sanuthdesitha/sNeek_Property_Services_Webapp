/**
 * Laundry partner pickup / drop schedule (owner decision 2026-11-13). PURE and
 * PLAIN (no "use client"): shared by the schedule route, the Suppliers
 * directory panel, the run panel hint, the portal and the run-creation prefill.
 *
 * DESCRIPTIVE DEFAULTS ONLY. The days of the week a partner usually collects /
 * returns and its usual windows. They:
 *  - prefill the planned TIME (`LaundryTask.pickupTime` / `dropoffTime`) of a
 *    NEW run for that partner when no time is set, using the window start and
 *    only when the run's day is one of the stated days (or no days are
 *    stated); never the date;
 *  - are shown to the office when planning and to the partner's team.
 * They never change the planner's date / turnaround rules (lib/laundry/planner.ts
 * `computeDraftItem`), the exception rules, or any existing run. Empty / null
 * = nothing prefilled and nothing shown as scheduled.
 */
import { z } from "zod";

export const SCHEDULE_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** 0 = Sunday ... 6 = Saturday (JavaScript `getUTCDay` of a calendar day key). */
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** Display order Monday first. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type PartnerSchedule = {
  pickupWeekdays: number[];
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  dropWeekdays: number[];
  dropWindowStart: string | null;
  dropWindowEnd: string | null;
};

export type ScheduleLeg = "pickup" | "drop";

export const EMPTY_PARTNER_SCHEDULE: PartnerSchedule = {
  pickupWeekdays: [], pickupWindowStart: null, pickupWindowEnd: null,
  dropWeekdays: [], dropWindowStart: null, dropWindowEnd: null,
};

const weekdays = z.array(z.number().int().min(0).max(6)).max(7);
const time = z.string().regex(SCHEDULE_TIME, "Use a 24-hour time such as 13:00.").nullable();

export const partnerScheduleInput = z
  .object({
    pickupWeekdays: weekdays,
    pickupWindowStart: time,
    pickupWindowEnd: time,
    dropWeekdays: weekdays,
    dropWindowStart: time,
    dropWindowEnd: time,
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const leg of ["pickup", "drop"] as const) {
      const start = value[`${leg}WindowStart`];
      const end = value[`${leg}WindowEnd`];
      if (end && !start) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`${leg}WindowStart`], message: "Give the start of the window, or clear the end." });
      if (start && end && end <= start) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`${leg}WindowEnd`], message: "The window must end after it starts." });
    }
  });

export type PartnerScheduleInput = z.infer<typeof partnerScheduleInput>;

/** Sorted, de-duplicated weekday list. */
export function normalizeWeekdays(days: readonly number[]): number[] {
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b);
}

export function normalizeSchedule(input: Omit<PartnerScheduleInput, "expectedUpdatedAt">): PartnerSchedule {
  return {
    pickupWeekdays: normalizeWeekdays(input.pickupWeekdays),
    pickupWindowStart: input.pickupWindowStart || null,
    pickupWindowEnd: input.pickupWindowEnd || null,
    dropWeekdays: normalizeWeekdays(input.dropWeekdays),
    dropWindowStart: input.dropWindowStart || null,
    dropWindowEnd: input.dropWindowEnd || null,
  };
}

/** Whether anything at all is stated for the leg. */
export function legStated(schedule: PartnerSchedule | null | undefined, leg: ScheduleLeg): boolean {
  if (!schedule) return false;
  return (leg === "pickup" ? schedule.pickupWeekdays : schedule.dropWeekdays).length > 0 || Boolean(leg === "pickup" ? schedule.pickupWindowStart : schedule.dropWindowStart);
}

export function scheduleStated(schedule: PartnerSchedule | null | undefined): boolean {
  return legStated(schedule, "pickup") || legStated(schedule, "drop");
}

/** "Mon to Sat", "Mon, Wed, Fri", "Every day"; null when no days are stated. */
export function describeWeekdays(days: readonly number[]): string | null {
  const set = new Set(normalizeWeekdays(days));
  if (set.size === 0) return null;
  if (set.size === 7) return "Every day";
  const ordered = WEEKDAY_ORDER.filter((day) => set.has(day));
  // A single run in Monday-first order reads as "Mon to Sat".
  const positions = ordered.map((day) => WEEKDAY_ORDER.indexOf(day));
  const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  if (contiguous && ordered.length >= 3) return `${WEEKDAY_SHORT[ordered[0]]} to ${WEEKDAY_SHORT[ordered[ordered.length - 1]]}`;
  return ordered.map((day) => WEEKDAY_SHORT[day]).join(", ");
}

function describeWindow(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${start} to ${end}` : `from ${start}`;
}

/** "Mon to Sat, 13:00 to 16:00"; null when nothing is stated for the leg. */
export function describeLeg(schedule: PartnerSchedule | null | undefined, leg: ScheduleLeg): string | null {
  if (!schedule || !legStated(schedule, leg)) return null;
  const days = describeWeekdays(leg === "pickup" ? schedule.pickupWeekdays : schedule.dropWeekdays);
  const window = leg === "pickup" ? describeWindow(schedule.pickupWindowStart, schedule.pickupWindowEnd) : describeWindow(schedule.dropWindowStart, schedule.dropWindowEnd);
  return [days ?? "Days not stated", window ?? "time not stated"].join(", ");
}

/** Weekdays with no pickup and no drop stated, when days are stated at all ("Sunday: no service"). */
export function noServiceDays(schedule: PartnerSchedule | null | undefined): number[] {
  if (!schedule || (schedule.pickupWeekdays.length === 0 && schedule.dropWeekdays.length === 0)) return [];
  const served = new Set([...schedule.pickupWeekdays, ...schedule.dropWeekdays]);
  return WEEKDAY_ORDER.filter((day) => !served.has(day));
}

function weekdayOfKey(dayKey: string): number | null {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

/**
 * The time to prefill for one leg of a new run on `dayKey` (calendar day,
 * organisation time), or null: the window start, only when a start is stated
 * and the day is one of the stated days (or no days are stated).
 */
export function defaultLegTime(schedule: PartnerSchedule | null | undefined, leg: ScheduleLeg, dayKey: string | null): string | null {
  if (!schedule || !dayKey) return null;
  const start = leg === "pickup" ? schedule.pickupWindowStart : schedule.dropWindowStart;
  if (!start || !SCHEDULE_TIME.test(start)) return null;
  const days = leg === "pickup" ? schedule.pickupWeekdays : schedule.dropWeekdays;
  if (days.length === 0) return start;
  const weekday = weekdayOfKey(dayKey);
  return weekday !== null && days.includes(weekday) ? start : null;
}

/** Whether the run's day falls outside the partner's stated days for the leg (a hint for the office). */
export function outsideStatedDays(schedule: PartnerSchedule | null | undefined, leg: ScheduleLeg, dayKey: string | null): boolean {
  if (!schedule || !dayKey) return false;
  const days = leg === "pickup" ? schedule.pickupWeekdays : schedule.dropWeekdays;
  if (days.length === 0) return false;
  const weekday = weekdayOfKey(dayKey);
  return weekday !== null && !days.includes(weekday);
}

/**
 * Planned times for a NEW run: an existing time always wins (never replaced),
 * a key-lost run is never prefilled (its time lives on the date itself), and
 * otherwise each leg gets `defaultLegTime`. Dates are inputs only.
 */
export function prefillPlannedTimes(
  schedule: PartnerSchedule | null | undefined,
  run: { pickupDayKey: string | null; dropDayKey: string | null; pickupTime?: string | null; dropoffTime?: string | null; keyLost?: boolean },
): { pickupTime: string | null; dropoffTime: string | null } {
  if (run.keyLost) return { pickupTime: run.pickupTime ?? null, dropoffTime: run.dropoffTime ?? null };
  return {
    pickupTime: run.pickupTime ?? defaultLegTime(schedule, "pickup", run.pickupDayKey),
    dropoffTime: run.dropoffTime ?? defaultLegTime(schedule, "drop", run.dropDayKey),
  };
}

export function scheduleFromRow(row: Partial<PartnerSchedule> | null | undefined): PartnerSchedule | null {
  if (!row) return null;
  return {
    pickupWeekdays: normalizeWeekdays(row.pickupWeekdays ?? []),
    pickupWindowStart: row.pickupWindowStart ?? null,
    pickupWindowEnd: row.pickupWindowEnd ?? null,
    dropWeekdays: normalizeWeekdays(row.dropWeekdays ?? []),
    dropWindowStart: row.dropWindowStart ?? null,
    dropWindowEnd: row.dropWindowEnd ?? null,
  };
}
