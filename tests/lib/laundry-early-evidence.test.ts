import { describe, it, expect } from "vitest";
import { earlyLaundryEvidenceConflict } from "@/lib/laundry/early-evidence";
const revision = "r1";
const receipt = { key: "key", fieldId: "laundry", destination: { type: "laundry" as const }, formRevision: revision };
const ready = { outcome: "READY_FOR_PICKUP", photoKey: "key", formRevision: revision };
describe("early laundry evidence boundary", () => {
  it("preserves legacy no-ledger behavior and old form laundry_photo receipts", () => {
    expect(earlyLaundryEvidenceConflict({}, ready)).toBe(false);
    expect(earlyLaundryEvidenceConflict({ id: { key: "key", fieldId: "laundry_photo", formRevision: revision } }, ready)).toBe(false);
  });
  it("accepts exactly the current acknowledged laundry photo", () => {
    expect(earlyLaundryEvidenceConflict({ id: receipt }, ready)).toBe(false);
  });
  it("rejects detached or misplaced photos from every typed destination", () => {
    expect(earlyLaundryEvidenceConflict({ id: { ...receipt, detached: true } }, ready)).toBe(true);
    for (const destination of [{ type: "bulkPool" as const }, { type: "jobTask" as const, taskId: "t1" }, { type: "carryForwardNew" as const }, { type: "formField" as const, fieldId: "other" }]) {
      expect(earlyLaundryEvidenceConflict({ id: { ...receipt, destination } }, ready)).toBe(true);
    }
  });
  it("rejects omission, substitution, outcome changes and stale revisions", () => {
    for (const changed of [{ photoKey: undefined }, { photoKey: "another" }, { outcome: "NOT_READY" }, { outcome: "NO_PICKUP_REQUIRED" }, { formRevision: "old" }]) {
      expect(earlyLaundryEvidenceConflict({ id: receipt }, { ...ready, ...changed })).toBe(true);
    }
  });
  it("does not require unrelated job receipts or previously removed unused photos", () => {
    expect(earlyLaundryEvidenceConflict({ other: { ...receipt, key: "other", destination: { type: "bulkPool" } }, removed: { ...receipt, key: "removed", detached: true } }, ready)).toBe(false);
  });
});
