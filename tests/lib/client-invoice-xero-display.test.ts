// @vitest-environment node
import { describe, expect, it } from "vitest";
import { xeroDisplay } from "@/lib/billing/client-invoice-xero-display";
import { clientInvoiceStages } from "@/lib/billing/client-invoice-stage";
import { describeInvoiceAudit } from "@/lib/billing/client-invoice-history";

const pushed = { xeroInvoiceId: "x", xeroExportedAt: "2026-11-01T00:00:00Z", xeroState: "PUSHED" as const };
const sync = (state: "IN_XERO" | "PAID_IN_XERO" | "NEEDS_REVIEW" | "UNKNOWN", reason: string | null = null) => ({ state, reason, xeroStatus: "AUTHORISED", checkedAt: "2026-11-11T00:20:00Z", lastReadAt: null });

describe("Xero states on screen come from stored facts only", () => {
  it.each([
    [{ xeroInvoiceId: null, xeroExportedAt: null, xeroState: "NONE" as const }, "Not in Xero"],
    [{ xeroInvoiceId: null, xeroExportedAt: null, xeroState: "PENDING" as const }, "Push pending"],
    // Wave D: a failed push is recorded distinctly, with its reason.
    [{ xeroInvoiceId: null, xeroExportedAt: null, xeroState: "PENDING" as const, xeroPushFailure: { reason: "Xero API error (400): bad", at: "2026-11-11T00:00:00Z" } }, "Push failed"],
    [{ ...pushed, xeroSync: null }, "In Xero · not yet checked"],
    [{ ...pushed, xeroSync: sync("IN_XERO") }, "Synced"],
    [{ ...pushed, xeroSync: sync("PAID_IN_XERO") }, "Synced · paid in Xero"],
    [{ ...pushed, xeroSync: sync("NEEDS_REVIEW", "Totals differ") }, "Needs review"],
    [{ ...pushed, xeroSync: sync("UNKNOWN", "Xero state unknown: rate limited") }, "State unknown"],
  ])("%j → %s", (facts, label) => {
    expect(xeroDisplay(facts).label).toBe(label);
  });

  it("never claims a check that did not happen", () => {
    expect(xeroDisplay({ ...pushed, xeroSync: null })).toMatchObject({ key: "unchecked", checkedAt: null, reason: null });
    expect(xeroDisplay({ xeroInvoiceId: null, xeroExportedAt: null, xeroState: "PENDING", xeroPushFailure: { reason: "why", at: "2026-11-11T00:00:00Z" } })).toMatchObject({ key: "failed", reason: "why", checkedAt: "2026-11-11T00:00:00Z" });
    expect(xeroDisplay({ ...pushed, xeroSync: sync("UNKNOWN", "why") })).toMatchObject({ reason: "why", checkedAt: "2026-11-11T00:20:00Z" });
  });

  it("the stage bar's In Xero note and Paid come from real state", () => {
    const stages = (extra: object) => clientInvoiceStages({ status: "SENT", sentAt: "x", ...pushed, ...extra }).stages;
    expect(stages({ xeroSync: sync("NEEDS_REVIEW") }).find((s) => s.key === "xero")).toMatchObject({ state: "done", note: "Needs review" });
    expect(stages({ xeroSync: sync("UNKNOWN") }).find((s) => s.key === "xero")?.note).toBe("State unknown");
    // Xero saying paid does not make the local Paid stage done.
    expect(stages({ xeroSync: sync("PAID_IN_XERO") }).find((s) => s.key === "paid")?.state).toBe("todo");
    expect(stages({ xeroSync: sync("IN_XERO") }).find((s) => s.key === "xero")?.note).toBe("Synced");
    expect(stages({ xeroSync: null }).find((s) => s.key === "xero")?.note).toBe("Not yet checked");
    const unsent = (extra: object) => clientInvoiceStages({ status: "APPROVED", sentAt: null, xeroInvoiceId: null, xeroState: "PENDING", ...extra }).stages;
    expect(unsent({}).find((s) => s.key === "xero")).toMatchObject({ state: "pending", note: "Push pending" });
    expect(unsent({ xeroPushFailure: { reason: "x", at: "" } }).find((s) => s.key === "xero")).toMatchObject({ state: "pending", note: "Push failed" });
  });

  it("labels Xero history rows in plain words", () => {
    expect(describeInvoiceAudit("CLIENT_INVOICE_PAYMENT_RECORD", { source: "XERO", amount: 50, paidDate: "2026-11-01T00:00:00.000Z" })).toBe("Payment of $50.00 recorded from Xero (paid 2026-11-01)");
    expect(describeInvoiceAudit("CLIENT_INVOICE_XERO_SYNC", { state: "NEEDS_REVIEW", reason: "Totals differ", paymentsRecorded: 0 })).toBe("Checked against Xero: needs review (Totals differ)");
  });
});
