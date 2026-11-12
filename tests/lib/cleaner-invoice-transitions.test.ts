// @vitest-environment node
/**
 * Money step (e): the one cleaner-invoice transition table, for every status
 * (including legacy rows written before APPROVED existed) and both roles.
 */
import { describe, expect, it } from "vitest";
import {
  actionForTargetStatus,
  availableCleanerInvoiceActions,
  cleanerInvoiceTransition,
  primaryCleanerInvoiceAction,
  type CleanerInvoiceAction,
} from "@/lib/cleaner/invoice-transitions";
import { cleanerInvoiceStages, describeCleanerAudit } from "@/lib/cleaner/invoice-review";

const facts = (status: string, extra: Partial<{ xeroBillId: string | null; paidAt: Date | null; paidAmount: number | null }> = {}) => ({
  status, xeroBillId: null, paidAt: null, paidAmount: null, ...extra,
});

// Expected ADMIN actions per status, without a Xero bill or payment unless noted.
const TABLE: Array<[string, Partial<{ xeroBillId: string }>, CleanerInvoiceAction[]]> = [
  ["SENDING", {}, ["review-delivery"]],
  ["SUBMITTED", {}, ["approve", "request-changes", "reverse", "delete"]],
  ["APPROVED", {}, ["push-xero", "record-payment", "request-changes", "reverse", "delete"]],
  ["CHANGES_REQUESTED", {}, ["delete"]],
  ["XERO_EXPORTING", {}, ["push-xero"]],
  ["XERO_PUSHED", { xeroBillId: "bill" }, ["record-payment"]],
  ["PAID_CLAIMED", {}, ["record-payment", "reject-claim", "delete"]],
  ["PAID_CLAIMED", { xeroBillId: "bill" }, ["record-payment", "reject-claim"]],
  ["PAID", {}, []],
  ["VOID", {}, ["delete"]],
];

describe("transition table", () => {
  it.each(TABLE)("ADMIN on %s %j may: %j", (status, extra, expected) => {
    expect(availableCleanerInvoiceActions(facts(status, extra), "ADMIN")).toEqual(expected);
  });

  it.each(TABLE)("OPS_MANAGER on %s %j may do the same except approve", (status, extra, expected) => {
    expect(availableCleanerInvoiceActions(facts(status, extra), "OPS_MANAGER")).toEqual(expected.filter((action) => action !== "approve"));
  });

  it("approve is ADMIN only, answered 403 for anyone else", () => {
    expect(cleanerInvoiceTransition("approve", facts("SUBMITTED"), "OPS_MANAGER")).toEqual({ ok: false, status: 403, reason: "Only an administrator can approve cleaner invoices." });
    expect(cleanerInvoiceTransition("approve", facts("SUBMITTED"), "ADMIN")).toEqual({ ok: true, to: "APPROVED" });
  });

  it("legacy rows stay actionable: SUBMITTED is approved first, XERO_PUSHED can still be paid", () => {
    expect(cleanerInvoiceTransition("push-xero", facts("SUBMITTED"), "ADMIN")).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining("Approve") });
    expect(cleanerInvoiceTransition("record-payment", facts("SUBMITTED"), "ADMIN")).toMatchObject({ ok: false, status: 409 });
    expect(cleanerInvoiceTransition("record-payment", facts("XERO_PUSHED", { xeroBillId: "b" }), "OPS_MANAGER")).toEqual({ ok: true, to: "PAID" });
  });

  it("refuses any change once paid, exported or with payment evidence", () => {
    for (const action of ["approve", "request-changes", "reverse", "delete", "push-xero"] as const) {
      expect(cleanerInvoiceTransition(action, facts("APPROVED", { paidAmount: 0 }), "ADMIN").ok).toBe(false);
      expect(cleanerInvoiceTransition(action, facts("SUBMITTED", { xeroBillId: "b" }), "ADMIN").ok).toBe(false);
    }
    expect(cleanerInvoiceTransition("record-payment", facts("PAID_CLAIMED", { paidAt: new Date() }), "ADMIN").ok).toBe(false);
  });

  it("a rejected claim lands back where it was: In Xero when a bill exists", () => {
    expect(cleanerInvoiceTransition("reject-claim", facts("PAID_CLAIMED"), "ADMIN")).toEqual({ ok: true, to: "SUBMITTED" });
    expect(cleanerInvoiceTransition("reject-claim", facts("PAID_CLAIMED", { xeroBillId: "b" }), "ADMIN")).toEqual({ ok: true, to: "XERO_PUSHED" });
  });

  it("maps a PATCH target to its action; XERO_PUSHED is never accepted from a request", () => {
    expect(actionForTargetStatus("SUBMITTED", "APPROVED")).toBe("approve");
    expect(actionForTargetStatus("PAID_CLAIMED", "SUBMITTED")).toBe("reject-claim");
    expect(actionForTargetStatus("APPROVED", "SUBMITTED")).toBeNull();
    expect(actionForTargetStatus("APPROVED", "XERO_PUSHED")).toBeNull();
  });
});

describe("one primary action per row", () => {
  it.each([
    ["SUBMITTED", {}, "review"],
    ["APPROVED", {}, "push-xero"],
    ["XERO_PUSHED", { xeroBillId: "b" }, "record-payment"],
    ["PAID_CLAIMED", {}, "review-payment"],
    ["SENDING", {}, "review-delivery"],
    ["XERO_EXPORTING", {}, "push-xero"],
    ["PAID", {}, "view"],
    ["VOID", {}, "view"],
    ["CHANGES_REQUESTED", {}, "view"],
  ])("%s → %s", (status, extra, primary) => {
    expect(primaryCleanerInvoiceAction(facts(status, extra), "ADMIN")).toBe(primary);
  });
});

describe("review page stages and history", () => {
  it("shows Submitted → Approved → In Xero → Paid from real state", () => {
    const states = (status: string, xero: string | null, approvedAt: string | null) =>
      cleanerInvoiceStages({ status: status as never, xeroBillId: xero }, approvedAt).stages.map((stage) => `${stage.key}:${stage.state}`);
    expect(states("SUBMITTED", null, null)).toEqual(["submitted:current", "approved:todo", "xero:todo", "paid:todo"]);
    expect(states("APPROVED", null, "t")).toEqual(["submitted:done", "approved:current", "xero:todo", "paid:todo"]);
    expect(states("XERO_PUSHED", "b", "t")).toEqual(["submitted:done", "approved:done", "xero:done", "paid:todo"]);
    // A legacy row pushed before approval existed does not pretend it was approved.
    expect(states("XERO_PUSHED", "b", null)[1]).toBe("approved:passed");
    expect(states("PAID", null, "t")).toEqual(["submitted:done", "approved:done", "xero:skipped", "paid:done"]);
    expect(cleanerInvoiceStages({ status: "VOID" as never, xeroBillId: null }, null).terminal?.title).toBe("Reversed");
  });

  it("labels audit rows in plain words", () => {
    expect(describeCleanerAudit("CLEANER_INVOICE_STATUS_UPDATE", { status: "APPROVED" })).toBe("Approved");
    expect(describeCleanerAudit("CLEANER_INVOICE_STATUS_UPDATE", { status: "XERO_PUSHED", action: "push-xero" })).toBe("Pushed to Xero as a draft bill");
    expect(describeCleanerAudit("CLEANER_INVOICE_STATUS_UPDATE", { status: "PAID", paidAmount: 50 })).toBe("Payment recorded ($50.00)");
  });
});
