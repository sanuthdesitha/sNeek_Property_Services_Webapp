import { describe, expect, it } from "vitest";
import { DEFAULT_HOLIDAY_POLICY, applyHolidayMultiplier, holidayCalendarSchema, holidayFraction, holidayPolicySchema, resolveHolidayMultipliers } from "@/lib/finance/holiday-policy";
import { parseNswHolidayCalendar } from "@/lib/finance/holiday-calendar";
import cache from "@/lib/finance/nsw-holiday-cache.json";
const calendar = holidayCalendarSchema.parse(cache);
const resolve = (day: string, extra = {}) => holidayFraction({ calendar, timezone: "Australia/Sydney", area: "Sydney", scheduledDay: day, intervals: [], ...extra });
describe("declared holiday calendar", () => {
 it("recognizes the verified NSW Labour Day and additional days, excluding bank holidays", () => {
  for (const day of ["2026-10-05", "2026-04-27", "2026-12-28", "2027-12-27", "2027-12-28"]) expect(resolve(day).fraction).toBe(1);
  expect(resolve("2026-08-03").fraction).toBe(0); expect(resolve("2026-10-04").fraction).toBe(0);
  expect(() => resolve("2032-10-04")).toThrow("does not cover");
 });
 it("uses actual instants across the Sydney DST boundary and midnight without double-counting overlapping logs", () => {
  const intervals = [{ start: "2026-10-04T12:00:00Z", end: "2026-10-04T14:00:00Z" }];
  expect(resolve("2026-10-04", { intervals }).fraction).toBe(0.5);
  expect(resolve("2026-10-04", { intervals: [...intervals, ...intervals] }).fraction).toBe(0.5);
  expect(resolve("2026-10-04", { intervals: [{ start: "2026-10-04T13:00:00Z", end: "2026-10-04T14:00:00Z" }] }).fraction).toBe(1);
 });
 it("does not extend a regional part-day holiday to Sydney and requires real times for the affected area", () => {
  const local = { ...calendar, entries: [{ date: "2026-10-06", name: "Fixture local declaration", kind: "LOCAL" as const, area: "Walcha", startMinute: 720, endMinute: 1080 }, { date: "2026-10-06", name: "Fixture event day", kind: "EVENT" as const, area: "Sydney", startMinute: 0, endMinute: 1440 }] };
  expect(resolve("2026-10-06", { calendar: local }).fraction).toBe(0);
  expect(() => resolve("2026-10-06", { calendar: local, area: "Walcha" })).toThrow("actual work");
  expect(resolve("2026-10-06", { calendar: local, area: "Walcha", intervals: [{ start: "2026-10-06T00:00:00Z", end: "2026-10-06T02:00:00Z" }] }).fraction).toBe(0.5);
 });
 it("uses supplied substituted declarations rather than inferring Sunday holidays", () => {
  const substituted = { ...calendar, years: [2031], entries: [{ date: "2031-01-27", name: "Australia Day", kind: "STATEWIDE" as const, startMinute: 0, endMinute: 1440 }] };
  expect(resolve("2031-01-26", { calendar: substituted }).fraction).toBe(0);
  expect(resolve("2031-01-27", { calendar: substituted }).fraction).toBe(1);
 });
 it("accepts explicit job decisions separately from automatic calendar classification", () => {
  expect(resolve("2026-10-05", { override: "ORDINARY" }).fraction).toBe(0);
  expect(resolve("2032-10-04", { override: "HOLIDAY" }).basis).toBe("OVERRIDE");
 });
 it("parses changing official table years and rejects incomplete/provider-error responses", () => {
  const rows = ["New Year's Day", "Australia Day", "Good Friday", "Easter Saturday", "Easter Sunday", "Easter Monday", "Anzac Day", "Labour Day", "Bank Holiday"].map((name, i) => `<tr><td>${name}</td><td>Monday ${i + 1} October 2035</td></tr>`).join("");
  const parsed = parseNswHolidayCalendar(`<table><tr><th>Holiday</th><th>2035</th></tr>${rows}</table>`, "2035-01-01T00:00:00Z");
  expect(parsed.years).toEqual([2035]); expect(parsed.entries[8].kind).toBe("BANK");
  expect(() => parseNswHolidayCalendar("<html>Provider unavailable</html>", "2035-01-01T00:00:00Z")).toThrow();
 });
});
it("resolves independent, explicit job/cleaner/property/client/default precedence", () => {
 const context = { clientId: "c", clientName: "Jackson", propertyId: "p", cleanerId: "u" };
 expect(resolveHolidayMultipliers(DEFAULT_HOLIDAY_POLICY, context)).toMatchObject({ client: 1.5, cleaner: 1.25 });
 const policy = { ...DEFAULT_HOLIDAY_POLICY, clients: { c: 1.6 }, properties: { p: { client: 1.7, cleaner: 1.3 } }, cleaners: { u: 1.4 } };
 expect(resolveHolidayMultipliers(policy, context)).toMatchObject({ client: 1.7, cleaner: 1.4 });
 expect(resolveHolidayMultipliers(policy, { ...context, clientOverride: 1, cleanerOverride: 1.1 })).toMatchObject({ client: 1, cleaner: 1.1 });
 expect(resolveHolidayMultipliers(DEFAULT_HOLIDAY_POLICY, { ...context, clientName: "Different client" }).client).toBe(1);
 expect(applyHolidayMultiplier(100, 1.5, 1)).toBe(150); expect(applyHolidayMultiplier(40, 1.25, 1)).toBe(50);
 expect(applyHolidayMultiplier(40, 1.25, 0.5)).toBe(45);
 expect(holidayPolicySchema.safeParse({ ...policy, timezone: "Invalid/Zone" }).success).toBe(false);
 expect(holidayCalendarSchema.safeParse({ ...calendar, entries: [{ ...calendar.entries[0], date: "2026-99-99" }] }).success).toBe(false);
});
