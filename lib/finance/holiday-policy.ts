import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value + "T00:00:00Z"); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "Invalid calendar date");
export const multiplier = z.number().finite().min(1).max(5);
export const holidayCalendarSchema = z.object({
  jurisdiction: z.string().regex(/^AU-[A-Z]{2,3}$/), version: z.string().min(1).max(200), sourceUrl: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith(".gov.au"); }),
  verifiedAt: z.string().datetime(), years: z.array(z.number().int().min(2000).max(2200)).min(1).max(10),
  entries: z.array(z.object({ date, name: z.string().min(1).max(200), kind: z.enum(["STATEWIDE", "LOCAL", "BANK", "EVENT"]), area: z.string().max(200).optional(), startMinute: z.number().int().min(0).max(1439).default(0), endMinute: z.number().int().min(1).max(1440).default(1440) }).refine(row => row.endMinute > row.startMinute && (row.kind !== "LOCAL" || !!row.area), "Local holidays need an area and a valid time window")).max(1000),
}).strict();
export type HolidayCalendar = z.infer<typeof holidayCalendarSchema>;
export const holidayPolicySchema = z.object({
  version: z.number().int().nonnegative(), timezone: z.string().refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Use an IANA timezone"),
  jurisdiction: z.string().regex(/^AU-[A-Z]{2,3}$/), localArea: z.string().min(1).max(200), maxCalendarAgeDays: z.number().int().min(1).max(90),
  clientDefault: multiplier, cleanerDefault: multiplier,
  clientNames: z.record(multiplier), clients: z.record(multiplier), cleaners: z.record(multiplier),
  properties: z.record(z.object({ client: multiplier.optional(), cleaner: multiplier.optional(), area: z.string().min(1).max(200).optional() }).strict()),
}).strict();
export type HolidayPolicy = z.infer<typeof holidayPolicySchema>;
export const DEFAULT_HOLIDAY_POLICY: HolidayPolicy = { version: 0, timezone: "Australia/Sydney", jurisdiction: "AU-NSW", localArea: "Sydney", maxCalendarAgeDays: 30, clientDefault: 1, cleanerDefault: 1.25, clientNames: { Jackson: 1.5 }, clients: {}, cleaners: {}, properties: {} };
export type WorkInterval = { start: string; end: string };
function union(intervals: Array<[number, number]>) {
  const result: Array<[number, number]> = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else result.push([...interval]);
  }
  return result;
}
function nextDay(day: string) { return new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10); }
function minuteInstant(day: string, minute: number, zone: string) {
  return fromZonedTime(minute === 1440 ? nextDay(day) + "T00:00:00" : `${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`, zone).getTime();
}
/** No inferred statutory dates: only the declared, versioned calendar is used. */
export function holidayFraction(input: { calendar: HolidayCalendar; timezone: string; area: string; scheduledDay: string; intervals: WorkInterval[]; override?: "HOLIDAY" | "ORDINARY" | "AUTO" }) {
  if (input.override && input.override !== "AUTO") return { fraction: input.override === "HOLIDAY" ? 1 : 0, names: ["Explicit job override"], localDates: [input.scheduledDay], basis: "OVERRIDE" };
  const entries = (day: string) => {
    if (!input.calendar.years.includes(Number(day.slice(0, 4)))) throw new Error("Calendar does not cover this work date. Refresh or record an explicit job override.");
    return input.calendar.entries.filter(entry => entry.date === day && (entry.kind === "STATEWIDE" || entry.kind === "LOCAL" && entry.area === input.area));
  };
  if (!input.intervals.length) {
    const matches = entries(input.scheduledDay);
    if (matches.some(entry => entry.startMinute !== 0 || entry.endMinute !== 1440)) throw new Error("Part-day holiday requires actual work start/end times or an explicit override.");
    return { fraction: matches.length ? 1 : 0, names: matches.map(entry => entry.name), localDates: [input.scheduledDay], basis: "SCHEDULED_DAY" };
  }
  const work = union(input.intervals.map(interval => {
    const start = Date.parse(interval.start), end = Date.parse(interval.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 14 * 86400000) throw new Error("Actual work intervals must have valid start and end times.");
    return [start, end];
  }));
  let elapsed = 0, holiday = 0; const names = new Set<string>(), localDates = new Set<string>();
  for (const [start, end] of work) {
    elapsed += end - start;
    let day = formatInTimeZone(new Date(start), input.timezone, "yyyy-MM-dd");
    const lastDay = formatInTimeZone(new Date(end - 1), input.timezone, "yyyy-MM-dd");
    const overlaps: Array<[number, number]> = [];
    while (day <= lastDay) {
      localDates.add(day);
      for (const entry of entries(day)) {
        const left = Math.max(start, minuteInstant(day, entry.startMinute, input.timezone));
        const right = Math.min(end, minuteInstant(day, entry.endMinute, input.timezone));
        if (right > left) { overlaps.push([left, right]); names.add(entry.name); }
      }
      day = nextDay(day);
    }
    holiday += union(overlaps).reduce((sum, [left, right]) => sum + right - left, 0);
  }
  return { fraction: holiday / elapsed, names: Array.from(names), localDates: Array.from(localDates), basis: "ACTUAL_WORK" };
}
export function resolveHolidayMultipliers(policy: HolidayPolicy, context: { clientId: string; clientName: string; propertyId: string; cleanerId?: string; clientOverride?: number; cleanerOverride?: number }) {
  const property = policy.properties[context.propertyId];
  const named = Object.entries(policy.clientNames).find(([name]) => name.trim().toLowerCase() === context.clientName.trim().toLowerCase());
  return {
    client: context.clientOverride ?? property?.client ?? policy.clients[context.clientId] ?? named?.[1] ?? policy.clientDefault,
    cleaner: context.cleanerOverride ?? (context.cleanerId ? policy.cleaners[context.cleanerId] : undefined) ?? property?.cleaner ?? policy.cleanerDefault,
    area: property?.area ?? policy.localArea,
  };
}
export function applyHolidayMultiplier(base: number, rateMultiplier: number, fraction: number) {
  if (!Number.isFinite(base) || base < 0 || fraction < 0 || fraction > 1) throw new Error("Invalid normal base or holiday fraction");
  return Math.round((base * (1 + (rateMultiplier - 1) * fraction) + Number.EPSILON) * 100) / 100;
}
