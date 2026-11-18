import { describe, expect, it } from "vitest";
import { payRequestHistory } from "@/lib/pay-adjustments/history";

/**
 * A request's history has two audiences. The office sees everything; the
 * cleaner sees what happened to their money and why — never the private note,
 * never whether or for how much the client is billed.
 */
const rows = [
  { action: "CLEANER_PAY_REQUEST_CREATED", createdAt: "2026-11-10T00:00:00Z", before: null, after: { amount: 80 }, actorName: "Cleaner" },
  {
    action: "REVIEW_PAY_ADJUSTMENT",
    createdAt: "2026-11-11T00:00:00Z",
    before: { status: "PENDING", adminNote: null, billToClient: false, clientAmount: null },
    after: { status: "APPROVED", approvedAmount: 80, adminNote: "third this month", billToClient: true, clientAmount: 120, decisionMessage: "Thanks" },
    actorName: "Admin",
  },
  {
    action: "EDIT_PAY_ADJUSTMENT_AMOUNT",
    createdAt: "2026-11-12T00:00:00Z",
    before: { approvedAmount: 80, clientAmount: 120 },
    after: { approvedAmount: 60, changeReason: "Only half the oven was done", reduction: true, clientAmount: 90 },
    actorName: "Admin",
  },
  { action: "PAY_ADJUSTMENT_CLIENT_BILLING_CHANGED", createdAt: "2026-11-13T00:00:00Z", before: { billToClient: true }, after: { billToClient: false }, actorName: "Ops" },
  { action: "PAY_ADJUSTMENT_MARKED_PAID", createdAt: "2026-11-14T00:00:00Z", before: null, after: { paidOutsideDate: "2026-11-14", paidOutsideMethod: "CASH", paidOutsideReference: "R1" }, actorName: "Admin" },
];

describe("pay request history", () => {
  it("the office sees every change, with who made it", () => {
    const history = payRequestHistory(rows, "internal");
    expect(history.map((entry) => entry.summary)).toEqual([
      "Requested $80.00",
      "Approved at $80.00",
      "Amount changed $80.00 → $60.00",
      "Client billing changed",
      "Marked paid outside the system on 2026-11-14 by cash",
    ]);
    const all = JSON.stringify(history);
    expect(all).toContain("Private note: third this month");
    expect(all).toContain("Client amount none → $120.00");
    expect(history[1].actorName).toBe("Admin");
  });

  it("the cleaner sees the reduction and its reason, but no private note, client amount or actor", () => {
    const history = payRequestHistory(rows, "self");
    expect(history.map((entry) => entry.summary)).toEqual([
      "Requested $80.00",
      "Approved at $80.00",
      "Amount changed $80.00 → $60.00",
      "Marked paid outside the system on 2026-11-14 by cash",
    ]);
    expect(history[2].details).toContain("Reason: Only half the oven was done");
    const all = JSON.stringify(history);
    expect(all).not.toMatch(/third this month|Client amount|\$120|\$90|Billed to the client|Private note/);
    expect(history.every((entry) => entry.actorName === null)).toBe(true);
    expect(all).toContain("Message: Thanks");
  });
});
