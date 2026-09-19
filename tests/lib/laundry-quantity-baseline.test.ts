import { describe, expect, it } from "vitest";
import { cleanerBagBaseline, recordedCleanerReadiness } from "@/lib/laundry/quantity-baseline";
const ready = (count: unknown, extra = {}) => ({ id: "ready", notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", unit: "bags", bagCount: count, ...extra }) });
describe("cleaner expected bag provenance", () => {
  it("uses only explicit cleaner counts, not driver actuals or guessed legacy values", () => {
    expect(cleanerBagBaseline([{ notes: '{"event":"PICKED_UP","bagCount":4}' }])).toBeNull();
    for (const count of [undefined, null, 0, 51, 1.5, "2"]) expect(cleanerBagBaseline([ready(count)])).toBeNull();
    expect(cleanerBagBaseline([ready(3), { notes: '{"event":"PICKED_UP","bagCount":4}' }])).toMatchObject({ count: 3, unit: "bags", confirmationId: "ready" });
  });
  it("does not fall back to an older count after a newer unknown or not-ready outcome", () => {
    expect(cleanerBagBaseline([ready(3), ready(undefined)])).toBeNull();
    expect(cleanerBagBaseline([ready(3), ready(3, { laundryOutcome: "NOT_READY" })])).toBeNull();
    expect(cleanerBagBaseline([ready(3, { unit: "sets" })])).toBeNull();
  });
  it("freezes a recorded readiness baseline even when its legacy count is unknown and later events exist", () => {
    const legacy = ready(undefined); const records = [legacy, { notes: '{"event":"PICKED_UP","bagCount":7}' }, { notes: '{"event":"EDIT_COMPLETED"}' }];
    expect(recordedCleanerReadiness(records)).toEqual(legacy); expect(cleanerBagBaseline(records)).toBeNull();
    expect(recordedCleanerReadiness([...records, ready(undefined, { laundryOutcome: "NOT_READY" })])).toBeNull();
  });
});
