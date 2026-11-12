// @vitest-environment node
/** Wave F pure rules: shopping run open/closed, quantities, pack levels, asks, tabs, counts, lost and found flag, laundry times. */
import { describe, expect, it } from "vitest";
import { plannedQuantityFor, shoppingRunClosedReason } from "@/lib/inventory/urgent-stock-shopping";
import { inventoryLevelAllows } from "@/lib/inventory/urgent-stock-access";
import { askRefusal } from "@/lib/inventory/urgent-stock-ask";
import { purchaseAskState } from "@/lib/inventory/urgent-stock-ask-state";
import { purchaseAskBody } from "@/lib/inventory/urgent-stock-ask-notify";
import { normalizeInventoryTab } from "@/components/v2/admin/inventory/inventory-tabs";
import { approvedCountDisposition } from "@/lib/inventory/stock-count-observations";
import { NEW_ITEM_FLAG_DAYS, unprocessedNewFlag } from "@/lib/lost-found/holding";
import { statusPill } from "@/components/v2/admin/lost-found/lost-found-format";
import { plannedTimesInput } from "@/lib/laundry/planned-times";
import { caseChargeRefusal } from "@/lib/billing/client-invoice-case-charge-rules";
import { needLinkSummary } from "@/components/v2/admin/inventory/urgent/need-links";

const open = { status: "DRAFT" as const, submittedAt: null, settlements: [] };

describe("shopping runs for urgent needs", () => {
  it("is open only while draft or active, unsubmitted and unsettled", () => {
    expect(shoppingRunClosedReason(open)).toBeNull();
    expect(shoppingRunClosedReason({ ...open, status: "ACTIVE" })).toBeNull();
    expect(shoppingRunClosedReason({ ...open, submittedAt: new Date() })).toMatch(/submitted/);
    expect(shoppingRunClosedReason({ ...open, status: "APPROVED" })).toMatch(/approved/);
    expect(shoppingRunClosedReason({ ...open, settlements: [{ includedInClientInvoiceId: null, includedInCleanerInvoiceId: "inv", includedInPayrollRunId: null, timeIncludedInCleanerInvoiceId: null, timeIncludedInPayrollRunId: null }] })).toMatch(/billed or paid/);
  });
  it("plans the chosen quantity, else the request, else par less count, and never a guessed zero", () => {
    expect(plannedQuantityFor({ chosen: 3, purchaseQuantity: 6, parLevel: 8, observedCount: 1 })).toBe(3);
    expect(plannedQuantityFor({ purchaseQuantity: 6, parLevel: 8, observedCount: 1 })).toBe(6);
    expect(plannedQuantityFor({ purchaseQuantity: null, parLevel: 8, observedCount: 1 })).toBe(7);
    expect(plannedQuantityFor({ purchaseQuantity: null, parLevel: null, observedCount: 1 })).toBeNull();
    expect(plannedQuantityFor({ purchaseQuantity: null, parLevel: 8, observedCount: 9 })).toBeNull();
  });
});

describe("operations manager inventory pack", () => {
  it("reads with read or manage, acts only with manage, and has no pack restriction when not a pack subject", () => {
    expect(inventoryLevelAllows("off", "read")).toBe(false);
    expect(inventoryLevelAllows("read", "read")).toBe(true);
    expect(inventoryLevelAllows("read", "manage")).toBe(false);
    expect(inventoryLevelAllows("manage", "manage")).toBe(true);
    expect(inventoryLevelAllows(null, "manage")).toBe(true);
  });
});

describe("asking a cleaner to buy", () => {
  const base = { stage: "ACKNOWLEDGED", shoppingRun: null, purchaseAsks: [] as Array<{ state: string; cleanerName: string }> };
  it("allows one live ask per open need not already on an open run", () => {
    expect(askRefusal(base)).toBeNull();
    expect(askRefusal({ ...base, stage: "ADMIN_RESOLVED" })).toMatch(/closed/);
    expect(askRefusal({ ...base, purchaseAsks: [{ state: "ASKED", cleanerName: "Jane" }] })).toMatch(/Jane was already asked/);
    expect(askRefusal({ ...base, purchaseAsks: [{ state: "DECLINED", cleanerName: "Jane" }] })).toBeNull();
    expect(askRefusal({ ...base, shoppingRun: { title: "Thu", ...open } })).toMatch(/Already on the open run/);
    expect(askRefusal({ ...base, shoppingRun: { title: "Thu", ...open, submittedAt: new Date() } })).toBeNull();
  });
  it("reads Bought only after submission with the item purchased and the reimbursement approved", () => {
    const line = { status: "PURCHASED", purchasedQty: 2 };
    expect(purchaseAskState("ASKED", null)).toBe("ASKED");
    expect(purchaseAskState("ACCEPTED", { submittedAt: null, reimbursementApproved: false, line })).toBe("ACCEPTED");
    expect(purchaseAskState("ACCEPTED", { submittedAt: new Date(), reimbursementApproved: false, line: { status: "PLANNED", purchasedQty: 0 } })).toBe("ACCEPTED");
    expect(purchaseAskState("ACCEPTED", { submittedAt: new Date(), reimbursementApproved: false, line })).toBe("BOUGHT_AWAITING_APPROVAL");
    expect(purchaseAskState("ACCEPTED", { submittedAt: new Date(), reimbursementApproved: true, line })).toBe("BOUGHT");
  });
  it("words the notice truthfully (an ask, a shopping run, office approval)", () => {
    const body = purchaseAskBody({ itemName: "Soap", quantity: 3, unit: "bottle", propertyName: "Bondi", jobNumber: "J-1", note: null });
    expect(body).toContain("asks if you can buy 3 bottle of Soap for Bondi before job J-1");
    expect(body).toContain("office approves the reimbursement");
  });
  it("summarises the run or ask on the row without claiming a delivery", () => {
    expect(needLinkSummary({ unit: "roll", purchaseAsk: null, shoppingRun: { id: "r", title: "Thu", open: true, ownerName: "O", line: { plannedQty: 4, purchasedQty: 0, purchased: false } } })).toBe('On run "Thu"');
    expect(needLinkSummary({ unit: "roll", purchaseAsk: null, shoppingRun: { id: "r", title: "Thu", open: false, ownerName: "O", line: null } })).toBe('Was on run "Thu" (line removed)');
    expect(needLinkSummary({ unit: "roll", shoppingRun: null, purchaseAsk: { id: "a", state: "ASKED", cleanerName: "Jane", askedByName: "Office", askedAt: "", respondedAt: null, responseNote: null, quantity: 2 } })).toBe("Asked Jane");
  });
});

describe("Stock tabs", () => {
  it("keeps every old id, maps the drawn names, and hides Urgent needs from those who cannot see it", () => {
    for (const tab of ["items", "properties", "on-hand", "stock-counts", "scan-tasks", "shopping-runs", "suppliers"]) expect(normalizeInventoryTab(tab, true)).toBe(tab);
    expect(normalizeInventoryTab(undefined, true)).toBe("urgent-stock");
    expect(normalizeInventoryTab(undefined, false)).toBe("items");
    expect(normalizeInventoryTab("urgent-stock", false)).toBe("items");
    expect(normalizeInventoryTab("catalogue", true)).toBe("items");
    expect(normalizeInventoryTab("levels", true)).toBe("properties");
    expect(normalizeInventoryTab("Urgent", true)).toBe("urgent-stock");
    expect(normalizeInventoryTab("nonsense", true)).toBe("items");
  });
});

describe("stock count observations", () => {
  const at = new Date("2026-11-12T01:00:00Z");
  it("applies unless another stock movement was recorded at or after the count", () => {
    expect(approvedCountDisposition({ observedAt: at, latestOtherLedgerAt: null })).toBe("APPLY");
    expect(approvedCountDisposition({ observedAt: at, latestOtherLedgerAt: new Date(at.getTime() - 1) })).toBe("APPLY");
    expect(approvedCountDisposition({ observedAt: at, latestOtherLedgerAt: at })).toBe("SKIPPED_NEWER");
  });
});

describe("lost and found: still New after the named threshold", () => {
  const now = new Date("2026-11-20T02:00:00Z");
  it("flags only REPORTED items found more than 14 days ago, by organisation calendar days", () => {
    expect(NEW_ITEM_FLAG_DAYS).toBe(14);
    expect(unprocessedNewFlag({ status: "REPORTED", foundAt: new Date("2026-11-06T02:00:00Z"), now, timeZone: "Australia/Sydney" })).toBeNull();
    expect(unprocessedNewFlag({ status: "REPORTED", foundAt: new Date("2026-11-05T02:00:00Z"), now, timeZone: "Australia/Sydney" })).toEqual({ days: 15 });
    expect(unprocessedNewFlag({ status: "IN_STORAGE", foundAt: new Date("2026-10-01T02:00:00Z"), now, timeZone: "Australia/Sydney" })).toBeNull();
    expect(statusPill("REPORTED", { counts: false, days: null, past: false }, { days: 15 })).toEqual({ label: "New · 15 d", tone: "warn" });
    expect(statusPill("REPORTED", { counts: false, days: null, past: false })).toEqual({ label: "New", tone: "bad" });
  });
});

describe("laundry planned times", () => {
  it("accepts HH:mm or null and refuses anything else", () => {
    expect(plannedTimesInput.parse({ pickupTime: "07:05", dropoffTime: null })).toEqual({ pickupTime: "07:05", dropoffTime: null });
    expect(() => plannedTimesInput.parse({ pickupTime: "7:05", dropoffTime: null })).toThrow();
    expect(() => plannedTimesInput.parse({ pickupTime: "24:00", dropoffTime: null })).toThrow();
  });
});

describe("case charge rule (under the invoice lock)", () => {
  const reader = (clientId: string | null, exists = true) => ({ issueTicket: { findUnique: async () => (exists ? { clientId: null, property: clientId ? { clientId } : null, job: null } : null) } }) as never;
  it("allows only a draft invoice of the case's client", async () => {
    expect(await caseChargeRefusal(reader("c1"), { status: "DRAFT", kind: "INVOICE", clientId: "c1" }, "case")).toBeNull();
    expect(await caseChargeRefusal(reader("c1"), { status: "APPROVED", kind: "INVOICE", clientId: "c1" }, "case")).toMatch(/draft/);
    expect(await caseChargeRefusal(reader("c1"), { status: "DRAFT", kind: "CREDIT_NOTE", clientId: "c1" }, "case")).toMatch(/credit note/);
    expect(await caseChargeRefusal(reader("c2"), { status: "DRAFT", kind: "INVOICE", clientId: "c1" }, "case")).toMatch(/different client/);
    expect(await caseChargeRefusal(reader(null), { status: "DRAFT", kind: "INVOICE", clientId: "c1" }, "case")).toMatch(/no client/);
    expect(await caseChargeRefusal(reader(null, false), { status: "DRAFT", kind: "INVOICE", clientId: "c1" }, "case")).toMatch(/no longer exists/);
  });
});
