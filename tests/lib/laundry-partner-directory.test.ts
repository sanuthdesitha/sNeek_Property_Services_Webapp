// @vitest-environment node
/**
 * Suppliers list read model and the Chase supplier fallback (2026-11-12):
 * laundry partners appear beside stock suppliers, a linked pair is one row, a
 * link to a deleted stock supplier is reported (never silently dropped), and
 * Chase supplier is offered when a team request applies but the partner has
 * nobody on the portal to ask, with a draft that asks for that.
 */
import { describe, expect, it } from "vitest";
import { buildSupplierDirectory, laundryRunsHref, type LaundryPartnerRecord, type StockSupplierRecord } from "@/lib/suppliers/directory-types";
import { draftSupplierChase, supplierChaseBlockedReason } from "@/lib/laundry/supplier-chase-rules";

const stock = (id: string, name: string): StockSupplierRecord => ({ id, name, email: null, phone: null, website: null, defaultLeadDays: 0, categories: [], notes: null, isActive: true });
const partner = (id: string, name: string, stockSupplierId: string | null = null): LaundryPartnerRecord => ({
  id, name, phone: null, email: null, address: null, pricePerKg: null, avgTurnaround: null, reliabilityScore: null, notes: null, isActive: true, stockSupplierId, team: [], runCount: 0,
});

describe("Suppliers list with laundry partners", () => {
  it("merges a linked pair, keeps unlinked partners as Laundry partner rows and reports dangling links", () => {
    const { rows, danglingLinks } = buildSupplierDirectory(
      [stock("s1", "Fresh Linen"), stock("s2", "Paper Co")],
      [partner("l1", "Fresh Linen Laundry", "s1"), partner("l2", "Bubbles"), partner("l3", "Gone Ltd", "deleted")],
    );
    expect(rows.map((row) => [row.key, row.kind])).toEqual([["laundry:l2", "LAUNDRY"], ["s1", "BOTH"], ["laundry:l3", "LAUNDRY"], ["s2", "STOCK"]]);
    expect(rows.find((row) => row.key === "s1")?.laundry?.id).toBe("l1");
    expect(danglingLinks).toEqual([{ laundrySupplierId: "l3", stockSupplierId: "deleted" }]);
    expect(laundryRunsHref("l 1")).toBe("/v2/admin/laundry?supplier=l%201");
  });
});

describe("Chase supplier when the partner has nobody on the portal", () => {
  it("is offered for an unanswered team request even before the turnaround is exceeded", () => {
    expect(supplierChaseBlockedReason({ status: "PENDING", hasSupplier: true, exceptions: [] })).toBe("The run is not at the laundry.");
    expect(supplierChaseBlockedReason({ status: "PENDING", hasSupplier: true, exceptions: [], unansweredTeamRequest: "TEAM_CONFIRM_PICKUP" })).toBeNull();
    expect(supplierChaseBlockedReason({ status: "PENDING", hasSupplier: false, exceptions: [], unansweredTeamRequest: "TEAM_CONFIRM_PICKUP" })).toBe("No supplier is recorded for this run.");
  });

  it("drafts what the team request would have asked", () => {
    const base = { supplierName: "Bubbles", propertyName: "Bondi Flat", propertySuburb: "Bondi", bagCount: 2, daysAtLaundry: 0, pickedUpLabel: "Thu 12 Nov", turnaroundHours: null, officeName: "sNeek", officePhone: null };
    expect(draftSupplierChase({ ...base, purpose: "TEAM_CONFIRM_PICKUP" })).toEqual({
      subject: "Laundry for Bondi Flat: please confirm the pickup",
      body: "Hi Bubbles, this is sNeek. About the laundry for Bondi Flat (Bondi) (2 bags). Please confirm the laundry pickup, or let us know when it will happen. Reply to this message.",
    });
    expect(draftSupplierChase(base).subject).toBe("Laundry for Bondi Flat: ready date?");
  });
});
