import { describe, expect, it } from "vitest";
import { savedCleanerLaundryUpdate, savedLaundrySignature } from "@/lib/laundry/saved-cleaner-update";
const row = { id: "cleaner", createdAt: "2026-10-04T03:06:00Z", bagLocation: "Shelf", s3Key: "laundry/photo.jpg", photoUrl: "/photo.jpg", notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", unit: "bags", bagCount: 2 }) };
describe("saved cleaner laundry projection", () => {
  it("uses the cleaner record, not a later driver's handoff or the read time", () => {
    const rows = [row, { ...row, id: "driver", createdAt: "2026-10-05T00:00:00Z", notes: JSON.stringify({ source: "PICKUP" }) }];
    const before = JSON.stringify(rows);
    const result = savedCleanerLaundryUpdate(rows)!;
    expect(result).toMatchObject({ id: "cleaner", recordedAt: "2026-10-04T03:06:00.000Z", bagCount: "2", photoKey: row.s3Key });
    expect(JSON.parse(savedLaundrySignature(result))).toMatchObject({ laundryOutcome: "READY_FOR_PICKUP", skipCode: null });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("preserves the latest non-ready update and reasons irrespective of query order", () => {
    const correction = { ...row, id: "correction", createdAt: "2026-10-04T04:00:00Z", notes: JSON.stringify({ source: "FINAL_SUBMISSION", laundryOutcome: "NO_PICKUP_REQUIRED", reasonCode: "OTHER", reasonNote: "No used linen" }) };
    expect(savedCleanerLaundryUpdate([correction, row])).toMatchObject({ id: "correction", outcome: "NO_PICKUP_REQUIRED", bagCount: "", skipCode: "OTHER", skipNote: "No used linen" });
  });
  it("does not invent a saved receipt from driver notes, malformed history or task status", () => {
    expect(savedCleanerLaundryUpdate([{ ...row, notes: "bad" }, { ...row, notes: "null" }, { ...row, notes: "{}" }, { ...row, createdAt: "invalid" }])).toBeNull();
    expect(savedCleanerLaundryUpdate([{ ...row, notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", bagCount: 99, unit: "bags" }) }])?.bagCount).toBe("");
  });
});
