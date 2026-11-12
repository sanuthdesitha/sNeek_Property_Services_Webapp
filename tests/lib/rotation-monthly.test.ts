// Wave B: "Monthly" cadence — first counted clean of each calendar month at
// the property (organisation timezone), from PropertyRotationState.lastCompletedAt.
import { describe, expect, it, vi } from "vitest";
import { collectMonthlyItems, collectRotationalItems, filterRotationalSchema, isMonthlyItemDue } from "@/lib/accountability/rotation-schema";
import { recordMonthlyShown, applyJobRotationCompletion } from "@/lib/accountability/rotation";

const SYD = "Australia/Sydney";
const schema = { sections: [{ id: "s", fields: [
  { id: "every", type: "checkbox" },
  { id: "oven", type: "yesno", frequency: "MONTHLY" },
  { id: "detail__bed1", type: "photo", frequency: "ROTATIONAL", rotationEveryNCleans: 3 },
] }] };
const ids = (value: typeof schema) => value.sections[0].fields.map((field) => field.id);

describe("isMonthlyItemDue", () => {
  it("is due when never shown, and once per calendar month", () => {
    expect(isMonthlyItemDue(null, new Date("2026-11-03T00:00:00Z"), SYD)).toBe(true);
    expect(isMonthlyItemDue(new Date("2026-11-01T01:00:00Z"), new Date("2026-11-28T01:00:00Z"), SYD)).toBe(false);
    expect(isMonthlyItemDue(new Date("2026-10-28T01:00:00Z"), new Date("2026-11-02T01:00:00Z"), SYD)).toBe(true);
  });
  it("uses the organisation timezone at the month boundary (AEDT, UTC+11)", () => {
    // 2026-10-31T13:30Z is 00:30 on 1 November in Sydney.
    expect(isMonthlyItemDue(new Date("2026-10-31T12:30:00Z"), new Date("2026-10-31T13:30:00Z"), SYD)).toBe(true);
    // Both still 31 October in Sydney.
    expect(isMonthlyItemDue(new Date("2026-10-30T14:00:00Z"), new Date("2026-10-31T12:30:00Z"), SYD)).toBe(false);
  });
  it("is correct across the daylight-saving change (Sydney, 5 April 2026, UTC+11 → UTC+10)", () => {
    // 31 March 23:30 local (AEDT) vs 1 April 00:30 local (AEDT).
    expect(isMonthlyItemDue(new Date("2026-03-31T12:30:00Z"), new Date("2026-03-31T13:30:00Z"), SYD)).toBe(true);
    // Shown 1 April (AEDT), next clean 6 April after DST ended: same month.
    expect(isMonthlyItemDue(new Date("2026-03-31T13:30:00Z"), new Date("2026-04-06T00:00:00Z"), SYD)).toBe(false);
    // 30 April 23:30 AEST = 13:30Z; 1 May 00:30 AEST = 14:30Z.
    expect(isMonthlyItemDue(new Date("2026-04-30T13:30:00Z"), new Date("2026-04-30T14:30:00Z"), SYD)).toBe(true);
  });
});

describe("filterRotationalSchema with monthly questions", () => {
  const now = new Date("2026-11-12T01:00:00Z");
  it("hides a monthly question already shown this month, shows it in a new month", () => {
    expect(ids(filterRotationalSchema(schema, [{ itemKey: "oven", cleansSinceDone: 0, lastCompletedAt: new Date("2026-11-02T01:00:00Z") }, { itemKey: "detail", cleansSinceDone: 5 }], { now, timeZone: SYD }))).toEqual(["every", "detail__bed1"]);
    expect(ids(filterRotationalSchema(schema, [{ itemKey: "oven", cleansSinceDone: 0, lastCompletedAt: new Date("2026-10-30T01:00:00Z") }, { itemKey: "detail", cleansSinceDone: 5 }], { now, timeZone: SYD }))).toEqual(["every", "oven", "detail__bed1"]);
  });
  it("never hides a monthly question without a clock, and leaves every-Nth rotation unchanged", () => {
    expect(ids(filterRotationalSchema(schema, [{ itemKey: "oven", cleansSinceDone: 0, lastCompletedAt: now }, { itemKey: "detail", cleansSinceDone: 0 }]))).toEqual(["every", "oven"]);
    expect(collectRotationalItems(schema)).toEqual([{ key: "detail", rotationEveryNCleans: 3 }]);
    expect(collectMonthlyItems(schema)).toEqual(["oven"]);
  });
});

describe("recording the monthly last-shown date", () => {
  it("stamps lastCompletedAt without touching an every-Nth counter", async () => {
    const tx = { propertyRotationState: { upsert: vi.fn() } };
    const shownAt = new Date("2026-10-31T13:30:00Z");
    await recordMonthlyShown(tx, { propertyId: "p", jobId: "j", itemKeys: ["oven"], shownAt });
    expect(tx.propertyRotationState.upsert).toHaveBeenCalledWith({
      where: { propertyId_itemKey: { propertyId: "p", itemKey: "oven" } },
      create: { propertyId: "p", itemKey: "oven", cleansSinceDone: 0, lastCompletedAt: shownAt, lastCompletedJobId: "j" },
      update: { lastCompletedAt: shownAt, lastCompletedJobId: "j" },
    });
  });
  it("on a counted clean, dates the stamp by the submission, not the approval", async () => {
    const submittedAt = new Date("2026-10-31T12:00:00Z");
    const tx = {
      $queryRaw: vi.fn(), appSetting: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      job: { findUnique: vi.fn().mockResolvedValue({ status: "COMPLETED", isRework: false, internalNotes: null }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ createdAt: submittedAt, data: { __templateSchema: { sections: [{ fields: [{ id: "oven", type: "yesno", frequency: "MONTHLY" }] }] }, uploads: {} } }) },
      propertyRotationState: { upsert: vi.fn() },
    };
    await applyJobRotationCompletion(tx as never, { jobId: "j", propertyId: "p" });
    expect(tx.propertyRotationState.upsert).toHaveBeenCalledTimes(1);
    expect(tx.propertyRotationState.upsert.mock.calls[0][0].update).toEqual({ lastCompletedAt: submittedAt, lastCompletedJobId: "j" });
    expect(tx.appSetting.create).toHaveBeenCalledTimes(1);
  });
});
