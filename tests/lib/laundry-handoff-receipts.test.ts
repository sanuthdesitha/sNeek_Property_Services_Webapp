import { describe, it, expect } from "vitest";
import { buildHandoffReceipts, handoffTimeLabel } from "@/lib/laundry/handoff-receipts";

describe("recorded laundry handoffs", () => {
  it("uses stored actor/time and quantities without inferring a recipient acknowledgement", () => {
    const [receipt] = buildHandoffReceipts([{ id: "pickup", confirmedByName: "Alex", createdAt: "2026-09-12T23:00:00Z", notes: JSON.stringify({ event: "PICKED_UP", bagCount: 3 }), bagLocation: "Side gate", photoUrl: "https://files.example.test/proof.jpg" }]);
    expect(receipt).toMatchObject({ id: "pickup", actor: "Alex", at: "2026-09-12T23:00:00.000Z", label: "Pickup recorded", details: ["3 bags recorded", "Location: Side gate"], photoUrl: "https://files.example.test/proof.jpg" });
  });
  it("keeps malformed metadata and missing actor/time/quantity explicit", () => {
    const receipts = buildHandoffReceipts([{ notes: "legacy note", laundryReady: true, createdAt: "bad", photoUrl: "javascript:alert(1)" }, { notes: '{"event":"PICKED_UP","bagCount":-1}' }, { notes: '["PICKED_UP"]' }]);
    expect(receipts[0]).toMatchObject({ actor: "Name unavailable", at: null, label: "Readiness recorded: ready", photoUrl: null });
    expect(receipts[1].details).toEqual(["Bag count not recorded"]);
    expect(receipts[2].label).toBe("Laundry event recorded");
  });
  it("shows correction before/after separately, rather than inventing original immutable quantities", () => {
    const receipts = buildHandoffReceipts([{ createdAt: "2026-09-13T01:00:00Z", notes: JSON.stringify({ event: "EDIT_COMPLETED", reason: "One bag missed", changedFields: ["bagCount", "dropoffLocation"], before: { bagCount: 2, dropoffLocation: "Porch" }, after: { bagCount: 3, dropoffLocation: "Cupboard" } }) }, { createdAt: "2026-09-12T01:00:00Z", notes: '{"event":"PICKED_UP","bagCount":3}' }]);
    expect(receipts.map(row => row.label)).toEqual(["Pickup recorded", "Completion details corrected"]);
    expect(receipts[1].details).toEqual(["Reason: One bag missed", "Bags: 2 → 3", "Return location: Porch → Cupboard"]);
  });
  it("shows recorded exceptions and reversions without treating them as new handoffs", () => {
    const receipts = buildHandoffReceipts([{ notes: '{"event":"FAILED_PICKUP_REQUEST","requestedAction":"SKIP","approvalStatus":"PENDING","reason":"No access"}' }, { notes: '{"event":"REVERT_TO_PICKED_UP"}' }, { notes: '{"event":"FAILED_PICKUP_RESCHEDULE","rescheduledPickupDate":"2026-09-14T00:00:00Z"}' }]);
    expect(receipts[0].details).toEqual(["Reason: No access", "Requested: skip", "Recorded approval status: PENDING"]);
    expect(receipts[1].label).toBe("Return confirmation reverted");
    expect(receipts[2].details).toEqual(["New pickup date: 2026-09-14"]);
  });
  it("formats event instants in Sydney across DST", () => {
    expect(handoffTimeLabel("2026-10-03T15:30:00Z")).toContain("1:30");
    expect(handoffTimeLabel("2026-10-03T16:30:00Z")).toContain("3:30");
  });
  it("shows the cleaner's recorded reason for a not-ready or skipped handoff", () => {
    const [receipt] = buildHandoffReceipts([{ laundryReady: false, notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "NOT_READY", reasonCode: "MISSING_LINEN", reasonNote: "Two sets missing from the cupboard" }) }]);
    expect(receipt.label).toBe("Readiness recorded: not ready");
    expect(receipt.details).toEqual(["Reason: Two sets missing from the cupboard", "Reason code: MISSING LINEN"]);
  });
});
