import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (v: string) => v }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));

import { releaseInvoiceConsumables } from "@/lib/billing/client-invoices";

/**
 * VOIDING AN INVOICE MUST HAND BACK THE WORK ON IT.
 *
 * The rule is "resubmit a new invoice, the items stay unpaid". Before this, the
 * double-bill stamps were never cleared, so a voided invoice took its shopping
 * reimbursements and client-paid repairs with it — permanently marked as billed
 * against an invoice nobody would ever pay. The charge vanished, silently.
 *
 * The transaction client is a stub rather than a database: what is being pinned
 * is WHICH rows are cleared and by WHAT key, and that is entirely visible in the
 * arguments.
 */
function stubTx() {
  const shopping = vi.fn(async () => ({ count: 2 }));
  const maintenance = vi.fn(async () => ({ count: 1 }));
  return {
    tx: {
      shoppingSettlement: { updateMany: shopping },
      maintenanceItemAssignment: { updateMany: maintenance },
    } as any,
    shopping,
    maintenance,
  };
}

describe("releaseInvoiceConsumables", () => {
  it("clears the shopping stamp for exactly this invoice", async () => {
    const { tx, shopping } = stubTx();
    await releaseInvoiceConsumables(tx, "inv-1");

    expect(shopping).toHaveBeenCalledWith({
      where: { includedInClientInvoiceId: "inv-1" },
      data: { includedInClientInvoiceId: null },
    });
  });

  it("clears BOTH maintenance columns, not just the id", async () => {
    // Leaving includedInClientInvoiceAt set would make a released repair read as
    // having been billed on a date it no longer belongs to.
    const { tx, maintenance } = stubTx();
    await releaseInvoiceConsumables(tx, "inv-1");

    expect(maintenance).toHaveBeenCalledWith({
      where: { includedInClientInvoiceId: "inv-1" },
      data: { includedInClientInvoiceId: null, includedInClientInvoiceAt: null },
    });
  });

  it("scopes by invoice id, never releasing another invoice's items", async () => {
    const { tx, shopping, maintenance } = stubTx();
    await releaseInvoiceConsumables(tx, "inv-2");

    for (const spy of [shopping, maintenance]) {
      expect(spy.mock.calls[0][0].where).toEqual({ includedInClientInvoiceId: "inv-2" });
    }
  });

  it("reports what it released, so the void can be logged honestly", async () => {
    const { tx } = stubTx();
    await expect(releaseInvoiceConsumables(tx, "inv-1")).resolves.toEqual({
      shoppingSettlements: 2,
      maintenanceAssignments: 1,
    });
  });

  it("is fine when the invoice consumed nothing", async () => {
    const tx = {
      shoppingSettlement: { updateMany: vi.fn(async () => ({ count: 0 })) },
      maintenanceItemAssignment: { updateMany: vi.fn(async () => ({ count: 0 })) },
    } as any;
    await expect(releaseInvoiceConsumables(tx, "inv-1")).resolves.toEqual({
      shoppingSettlements: 0,
      maintenanceAssignments: 0,
    });
  });

  it("uses the caller's transaction client, not the module-level db", async () => {
    // The release and the status change have to land together. Releasing
    // against an invoice that then failed to void would make the same work
    // billable on two live invoices at once.
    const { tx, shopping, maintenance } = stubTx();
    await releaseInvoiceConsumables(tx, "inv-1");
    expect(shopping).toHaveBeenCalledTimes(1);
    expect(maintenance).toHaveBeenCalledTimes(1);
  });
});
