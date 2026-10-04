import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { getClosedSemimonthlyPeriod, isInvoiceDueToday } from "@/lib/finance/cadence";
const cadence = { userId: "client", cadence: "SEMIMONTHLY" as const, invoiceDayOfWeek: null, invoiceDayOfMonth: null, lastInvoiceGeneratedAt: null };
it.each([
  ["2026-10-15T21:00:00Z", "2026-09-30T14:00:00.000Z", "2026-10-15T12:59:59.999Z"],
  ["2026-04-15T22:00:00Z", "2026-03-31T13:00:00.000Z", "2026-04-15T13:59:59.999Z"],
  ["2028-02-29T21:00:00Z", "2028-02-15T13:00:00.000Z", "2028-02-29T12:59:59.999Z"],
  ["2026-12-31T21:00:00Z", "2026-12-15T13:00:00.000Z", "2026-12-31T12:59:59.999Z"],
])("includes the entire closed half-month across DST/leap/year boundaries %s", (now,start,end) => {
  const period = getClosedSemimonthlyPeriod(new Date(now));
  expect(period.periodStart.toISOString()).toBe(start);
  expect(period.periodEnd.toISOString()).toBe(end);
  expect(period.availableAt).toEqual(new Date(now));
  expect(isInvoiceDueToday(cadence,new Date(now))).toBe(true);
  expect(isInvoiceDueToday(cadence,new Date(new Date(now).getTime()-1))).toBe(false);
  expect(isInvoiceDueToday({...cadence,lastInvoiceGeneratedAt:new Date(now)},new Date(new Date(now).getTime()+60_000))).toBe(false);
});
it.each(["2026-10-15T01:00:00Z", "2026-10-31T01:00:00Z", "2026-10-17T01:00:00Z"])("does not prepare on the cutoff or an unrelated day %s", now => {
  expect(isInvoiceDueToday(cadence,new Date(now))).toBe(false);
});
