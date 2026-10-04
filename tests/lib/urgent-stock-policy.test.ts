import { describe, expect, it } from "vitest";
import { countObservationDisposition as disposition, isUrgentStockClosed, urgentStockReminderDue as due, urgentStockReportInput, validateUrgentStockTransition as transition } from "@/lib/inventory/urgent-stock-policy";
const now = new Date("2026-10-04T06:00:00Z");
const earlier = new Date("2026-10-04T05:00:00Z");
const report = { propertyId: "p12", itemId: "toilet-paper", requestId: "b58c38ef-ce37-4594-9a53-ad5551d4efcd", observedCount: null, purchaseQuantity: null, observedAt: null, note: "Toilet paper needed; quantities not known." };
describe("urgent stock facts", () => {
 it("preserves unknown observation and purchase quantities separately", () => {
  expect(urgentStockReportInput.parse(report)).toEqual(report);
  expect(urgentStockReportInput.parse({ ...report, purchaseQuantity: 12 }).observedCount).toBeNull();
  expect(urgentStockReportInput.parse({ ...report, observedCount: 0, observedAt: now.toISOString() }).purchaseQuantity).toBeNull();
 });
 it("rejects coerced, negative, nonfinite and undated counts", () => {
  for (const observedCount of ["", "0", -1, Infinity, NaN, 2]) expect(urgentStockReportInput.safeParse({ ...report, observedCount }).success).toBe(false);
 });
 it("never writes stock for unknown, stale or future observations", () => {
  const base = { count: 4, observedAt: now, recordedAt: now, stockUpdatedAt: earlier, latestLedgerAt: null };
  expect(disposition(base)).toBe("APPLY");
  expect(disposition({ ...base, count: null })).toBe("UNKNOWN");
  expect(disposition({ ...base, observedAt: earlier })).toBe("STALE");
  expect(disposition({ ...base, latestLedgerAt: now })).toBe("STALE");
  expect(disposition({ ...base, recordedAt: earlier })).toBe("FUTURE");
  expect(disposition({ ...base, observedAt: new Date("2026-10-01"), stockUpdatedAt: null })).toBe("STALE");
 });
});
describe("urgent stock lifecycle", () => {
 it("keeps acknowledgement, order and delivery open", () => {
  for (const [from, to] of [["REPORTED", "ACKNOWLEDGED"], ["ACKNOWLEDGED", "ORDERED"], ["ORDERED", "DELIVERED"]] as const) {
   expect(() => transition({ from, to, isAdmin: false, reason: "Recorded action" })).not.toThrow();
   expect(isUrgentStockClosed(to)).toBe(false);
  }
 });
 it("requires fresh positive stock and explicit confirmation to close", () => {
  const base = { from: "DELIVERED", to: "PROPERTY_CONFIRMED", isAdmin: false, reason: "Checked at property" } as const;
  expect(() => transition(base)).toThrow();
  const proof = { observedCount: 12, observationApplied: true, needResolved: true, reason: "Enough stock now present" };
  expect(() => transition({ ...base, confirmation: proof })).not.toThrow();
  for (const override of [{ observedCount: null }, { observedCount: 0 }, { observationApplied: false }, { needResolved: false }]) expect(() => transition({ ...base, confirmation: { ...proof, ...override } })).toThrow();
 });
 it("allows only justified admin resolution and never rewrites closed history", () => {
  const base = { from: "REPORTED", to: "ADMIN_RESOLVED", isAdmin: true, reason: "Duplicate need covered by verified existing supply" } as const;
  expect(() => transition(base)).not.toThrow();
  expect(() => transition({ ...base, isAdmin: false })).toThrow();
  expect(() => transition({ ...base, reason: " " })).toThrow();
  expect(() => transition({ ...base, from: "PROPERTY_CONFIRMED" })).toThrow();
  expect(() => transition({ ...base, to: "DELIVERED" })).toThrow();
 });
});
it("bounds reminders, respects open acknowledgement and recalculates next-clean urgency", () => {
 const base = { settings: { enabled: true, intervalHours: 24, maxReminders: 3, beforeNextCleanHours: 12 }, stage: "ACKNOWLEDGED", now, createdAt: earlier, lastReminderAt: null, remindersSent: 0, nextCleanAt: new Date("2026-10-04T10:00:00Z") } as const;
 expect(due(base)).toBe(true);
 expect(due({ ...base, nextCleanAt: null })).toBe(false);
 expect(due({ ...base, nextCleanAt: new Date("2026-10-06T10:00:00Z") })).toBe(false);
 expect(due({ ...base, lastReminderAt: now })).toBe(false);
 expect(due({ ...base, remindersSent: 3 })).toBe(false);
 expect(due({ ...base, stage: "PROPERTY_CONFIRMED" })).toBe(false);
 expect(due({ ...base, settings: { ...base.settings, enabled: false } })).toBe(false);
});
