import { describe, it, expect } from "vitest";
import { shouldNotifyPayee } from "@/lib/finance/pay-adjustment-notify";

/**
 * The reported bug: the system proposes streak bonuses on its own, and when an
 * admin declined one the cleaner was emailed "Pay addition declined". They had
 * not asked for it and did not know it existed, so the first they heard of a
 * $40 bonus was being told they were not getting it.
 */
describe("shouldNotifyPayee", () => {
  it("stays silent when a system-proposed bonus is declined", () => {
    // The whole complaint, in one assertion.
    expect(shouldNotifyPayee({ source: "STREAK_10", kind: "REJECTED" }).notify).toBe(false);
    expect(shouldNotifyPayee({ source: "MONTHLY_RANK_1", kind: "REJECTED" }).notify).toBe(false);
  });

  it("still answers a cleaner who asked", () => {
    // They raised it, so they are owed the answer whatever it is.
    expect(shouldNotifyPayee({ source: null, kind: "REJECTED" }).notify).toBe(true);
    expect(shouldNotifyPayee({ source: undefined, kind: "REJECTED" }).notify).toBe(true);
    expect(shouldNotifyPayee({ source: "", kind: "REJECTED" }).notify).toBe(true);
    expect(shouldNotifyPayee({ source: "   ", kind: "REJECTED" }).notify).toBe(true);
  });

  it("always reports money that actually moved", () => {
    // Taking a deduction silently because "they did not ask for it" would be
    // indefensible. The reason not to send the decline is that NOTHING
    // happened — not that the cleaner is uninvolved.
    expect(shouldNotifyPayee({ source: "REWORK_DEDUCTION", kind: "APPROVED" }).notify).toBe(true);
    expect(
      shouldNotifyPayee({ source: "RECTIFICATION_DEDUCTION", kind: "APPROVED" }).notify
    ).toBe(true);
    expect(shouldNotifyPayee({ source: "STREAK_5", kind: "APPROVED" }).notify).toBe(true);
  });

  it("reports a changed or reversed amount on a system proposal", () => {
    // Both change what lands in their pay.
    expect(shouldNotifyPayee({ source: "STREAK_10", kind: "AMOUNT_CHANGED" }).notify).toBe(true);
    expect(
      shouldNotifyPayee({ source: "STREAK_10", kind: "REVERSED_TO_PENDING" }).notify
    ).toBe(true);
  });

  it("explains itself either way", () => {
    // "No email arrived" is a common support report; the log has to answer it.
    for (const kind of ["APPROVED", "REJECTED", "AMOUNT_CHANGED", "REVERSED_TO_PENDING"] as const) {
      expect(shouldNotifyPayee({ source: "STREAK_10", kind }).reason.length).toBeGreaterThan(0);
      expect(shouldNotifyPayee({ source: null, kind }).reason.length).toBeGreaterThan(0);
    }
  });
});
