/**
 * A small reader for the five-field cron expressions the worker schedules
 * (workers/boss.ts): numbers, `*`, `*\/n`, ranges and lists. Plain module, no
 * server imports, so the System health screen and its tests can use it.
 *
 * Times are wall-clock times in the schedule's time zone (the worker uses
 * Australia/Sydney). Nothing here starts, stops or changes a schedule.
 */
import { fromZonedTime, toZonedTime } from "date-fns-tz";

type CronField = { values: Set<number>; any: boolean };

export type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(source: string, [min, max]: [number, number]): CronField | null {
  const values = new Set<number>();
  if (source === "*") {
    for (let value = min; value <= max; value += 1) values.add(value);
    return { values, any: true };
  }
  for (const part of source.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let start = min;
    let end = max;
    if (range !== "*") {
      const [first, last] = range.split("-");
      start = Number(first);
      end = last === undefined ? (stepText === undefined ? start : max) : Number(last);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value === 7 && max === 6 ? 0 : value);
  }
  return { values, any: false };
}

/** Null when the expression uses a form this reader does not understand. */
export function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields = parts.map((part, index) => parseField(part, FIELD_RANGES[index]));
  if (fields.some((field) => field === null)) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as CronField[];
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function dayMatches(cron: ParsedCron, wall: Date): boolean {
  const dom = cron.dayOfMonth.values.has(wall.getDate());
  const dow = cron.dayOfWeek.values.has(wall.getDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (!cron.dayOfMonth.any && !cron.dayOfWeek.any) return dom || dow;
  return dom && dow;
}

const SEARCH_LIMIT_MINUTES = 8 * 24 * 60;

/** Walk minute by minute in wall-clock time (skipping whole hours and days that cannot match). */
function search(cron: ParsedCron, from: Date, timeZone: string, direction: 1 | -1): Date | null {
  const wall = toZonedTime(from, timeZone);
  wall.setSeconds(0, 0);
  wall.setMinutes(wall.getMinutes() + direction);
  for (let steps = 0; steps < SEARCH_LIMIT_MINUTES; steps += 1) {
    if (!cron.month.values.has(wall.getMonth() + 1) || !dayMatches(cron, wall)) {
      if (direction === 1) {
        wall.setHours(24, 0, 0, 0);
      } else {
        wall.setHours(0, 0, 0, 0);
        wall.setMinutes(-1);
      }
      continue;
    }
    if (!cron.hour.values.has(wall.getHours())) {
      if (direction === 1) wall.setHours(wall.getHours() + 1, 0, 0, 0);
      else wall.setMinutes(-1, 0, 0);
      continue;
    }
    if (cron.minute.values.has(wall.getMinutes())) return fromZonedTime(wall, timeZone);
    wall.setMinutes(wall.getMinutes() + direction);
  }
  return null;
}

/** The next time the schedule fires after `from`, or null when it cannot be worked out. */
export function nextCronRun(expression: string, from: Date, timeZone: string): Date | null {
  const cron = parseCron(expression);
  return cron ? search(cron, from, timeZone, 1) : null;
}

/** The last time the schedule should have fired at or before `from`. */
export function previousCronRun(expression: string, from: Date, timeZone: string): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  return search(cron, new Date(from.getTime() + 60_000), timeZone, -1);
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "every 5 min", "hourly", "hourly at :20", "daily 08:15", "Mondays 08:00"; the raw expression otherwise. */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;
  const [minute, hour, dom, month, dow] = parts;
  const everyMinute = /^\*\/(\d+)$/.exec(minute);
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  const plainMinute = /^\d+$/.test(minute) ? Number(minute) : null;
  const plainHour = /^\d+$/.test(hour) ? Number(hour) : null;
  const allDays = dom === "*" && month === "*";
  if (!allDays) return expression;
  if (minute === "*" && hour === "*" && dow === "*") return "every minute";
  if (everyMinute && hour === "*" && dow === "*") return `every ${everyMinute[1]} min`;
  if (plainMinute !== null && hour === "*" && dow === "*") return plainMinute === 0 ? "hourly" : `hourly at :${String(plainMinute).padStart(2, "0")}`;
  if (plainMinute !== null && everyHour && dow === "*") return plainMinute === 0 ? `every ${everyHour[1]} hours` : `every ${everyHour[1]} hours at :${String(plainMinute).padStart(2, "0")}`;
  if (plainMinute !== null && plainHour !== null && dow === "*") return `daily ${clock(plainHour, plainMinute)}`;
  if (plainMinute !== null && plainHour !== null && /^\d$/.test(dow)) return `${WEEKDAYS[Number(dow) % 7]} ${clock(plainHour, plainMinute)}`;
  return expression;
}

/** Roughly how many minutes apart runs are; used to sort frequent work first. */
export function cronIntervalMinutes(expression: string, from: Date, timeZone: string): number | null {
  const first = nextCronRun(expression, from, timeZone);
  if (!first) return null;
  const second = nextCronRun(expression, first, timeZone);
  return second ? Math.round((second.getTime() - first.getTime()) / 60_000) : null;
}
