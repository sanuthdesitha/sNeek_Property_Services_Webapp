// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { clientInvoiceHistory, describeInvoiceAudit } from "@/lib/billing/client-invoice-history";

describe("invoice history", () => {
  it("merges this invoice's audit rows with its stored dates, newest first", async () => {
    const findMany = vi.fn(async () => [
      { id: "a1", action: "CLIENT_INVOICE_PAYMENT_RECORD", after: { amount: 50, method: "BANK_TRANSFER" }, createdAt: new Date("2026-11-05T00:00:00Z"), user: { name: "Sam", email: null } },
    ]);
    const entries = await clientInvoiceHistory(
      { id: "inv", createdAt: new Date("2026-11-01T00:00:00Z"), sentAt: new Date("2026-11-02T00:00:00Z"), xeroExportedAt: null, paidAt: null },
      { auditLog: { findMany } } as never,
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entity: "ClientInvoice", entityId: "inv" } }));
    expect(entries.map((entry) => [entry.label, entry.source, entry.actor])).toEqual([
      ["Payment of $50.00 recorded (bank transfer)", "audit", "Sam"],
      ["Last sent to the client", "record", null],
      ["Invoice created", "record", null],
    ]);
  });

  it("falls back to the raw action name for an unknown audit action", () => {
    expect(describeInvoiceAudit("SOMETHING_NEW", null)).toBe("SOMETHING_NEW");
    expect(describeInvoiceAudit("CLIENT_INVOICE_REVERSED", { from: "SENT", reason: "Wrong rate" })).toBe("Reversed to draft from SENT: Wrong rate");
  });
});
