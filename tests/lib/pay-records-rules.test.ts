/**
 * Pure rules of the pay record pages (boards "Pay run", "Shopping run",
 * 2026-11-17): payout problem flags, stages and the primary action per stage
 * (a Failed run offers Set back to Confirmed, never Process), the shopping
 * line cost rule (a missing cost is "missing", never 0 on screen; the total is
 * unchanged), and the reimbursement approval rule.
 */
import { describe, expect, it } from "vitest";
import {
  attentionFirst,
  payoutProblems,
  payrollPrimaryAction,
  payrollRunStages,
} from "@/lib/payroll/run-presentation";
import { computeShoppingRunTotals } from "@/lib/inventory/shopping-runs";
import { describeMissingCosts, shoppingCostCoverage, shoppingLineCost } from "@/lib/inventory/shopping-line-cost";
import { reimbursementApprovalRefusal } from "@/lib/inventory/shopping-reimbursement-approval";
import { SENSITIVE_ACTIONS } from "@/lib/security/sensitive-actions";
import { SENSITIVE_ACTION_CAPABILITY, capabilityDefinition } from "@/lib/rbac/capabilities";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";

const bank = { status: "PENDING", method: "ABA_FILE", bankBsb: "062000", bankAccountNumber: "12345412", stripeAccountId: null };

describe("payout problem flags", () => {
  it("names a bank payout with no bank details and does not flag a complete one", () => {
    expect(payoutProblems(bank, { stripeConfigured: true })).toEqual([]);
    expect(payoutProblems({ ...bank, method: "MANUAL_BANK_TRANSFER", bankBsb: null, bankAccountNumber: null }, { stripeConfigured: true })).toEqual([
      expect.objectContaining({ code: "NO_BANK_DETAILS", label: "No bank details", detail: "Cannot go in the ABA file" }),
    ]);
  });

  it("flags an unfinished Stripe set-up and a server with no Stripe key, never as success", () => {
    const stripe = { ...bank, method: "STRIPE_CONNECT", bankBsb: null, bankAccountNumber: null };
    expect(payoutProblems({ ...stripe, stripeAccountId: null }, { stripeConfigured: true })[0].code).toBe("STRIPE_SETUP_UNFINISHED");
    expect(payoutProblems({ ...stripe, stripeAccountId: "acct_1" }, { stripeConfigured: false })[0].code).toBe("STRIPE_NOT_CONFIGURED");
    expect(payoutProblems({ ...stripe, stripeAccountId: "acct_1" }, { stripeConfigured: true })).toEqual([]);
  });

  it("has nothing left to flag on a paid payout, and sorts failed then flagged first", () => {
    expect(payoutProblems({ ...bank, status: "PAID", bankBsb: null }, { stripeConfigured: false })).toEqual([]);
    const rows = [
      { id: "a", ...bank, problems: [] },
      { id: "b", ...bank, problems: [{ code: "NO_BANK_DETAILS" as const, label: "", detail: "" }] },
      { id: "c", ...bank, status: "FAILED", problems: [] },
    ];
    expect(attentionFirst(rows).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });
});

describe("pay run stages and the primary action", () => {
  const format = (iso: string) => iso.slice(0, 10);
  it("follows the server: Process only on Confirmed and only for an administrator", () => {
    expect(payrollPrimaryAction("DRAFT", false).kind).toBe("confirm");
    expect(payrollPrimaryAction("CONFIRMED", true).kind).toBe("process");
    expect(payrollPrimaryAction("CONFIRMED", false)).toEqual({ kind: "process-admin-only", hint: "Only an administrator can send payouts." });
    expect(payrollPrimaryAction("COMPLETED", true).kind).toBe("download-aba");
    expect(payrollPrimaryAction("VOID", true).kind).toBe("none");
  });

  it("offers Set back to Confirmed on a Failed run instead of Process", () => {
    expect(payrollPrimaryAction("FAILED", true).kind).toBe("set-back-confirmed");
    expect(payrollPrimaryAction("FAILED", false).kind).toBe("failed-admin-only");
  });

  it("reads stages from stored dates; Void replaces the strip", () => {
    const confirmed = payrollRunStages({ status: "CONFIRMED", createdAt: "2026-11-15T08:40:00Z", confirmedAt: "2026-11-15T09:05:00Z", completedAt: null }, format);
    expect(confirmed.stages.map((stage) => stage.state)).toEqual(["done", "current", "todo", "todo"]);
    expect(confirmed.stages[1].note).toContain("totals frozen");
    const failed = payrollRunStages({ status: "FAILED", createdAt: "2026-11-15T08:40:00Z", confirmedAt: null, completedAt: "2026-11-16T00:00:00Z" }, format);
    expect(failed.stages[2]).toMatchObject({ state: "pending", note: "Failed" });
    expect(failed.stages[1]).toMatchObject({ state: "passed", note: "Time not recorded" });
    expect(payrollRunStages({ status: "VOID", createdAt: "x", confirmedAt: null, completedAt: null }, format).terminal?.title).toBe("Void");
  });

  it("registers the new PIN actions as administrator capabilities and the status reasons", () => {
    expect(SENSITIVE_ACTIONS["payroll.process"]).toBeTruthy();
    expect(SENSITIVE_ACTIONS["payroll.run_status"]).toBeTruthy();
    expect(capabilityDefinition(SENSITIVE_ACTION_CAPABILITY["payroll.process"]).tier).toBe("grant");
    expect(capabilityDefinition(SENSITIVE_ACTION_CAPABILITY["payroll.run_status"]).area).toBeNull();
    expect(REASON_CHOICES.payrollRunStatus.map((choice) => choice.label)).toEqual(["Paid outside the app", "Made by mistake (Void)", "Retry after failure", "Other…"]);
  });
});

describe("shopping line cost", () => {
  const row = (extra: Partial<Parameters<typeof shoppingLineCost>[0]> & { itemName?: string } = {}) => ({
    propertyName: "Bondi Beach House",
    itemName: "Hand wash refill",
    purchased: true,
    actualPurchasedQty: 3,
    actualUnitCost: null,
    actualLineCost: null,
    ...extra,
  });

  it("says missing for a bought line with no cost, and costs a line from its stored figures", () => {
    expect(shoppingLineCost(row())).toEqual({ state: "missing" });
    expect(shoppingLineCost(row({ actualUnitCost: 0.95, actualPurchasedQty: 12 }))).toEqual({ state: "costed", unitCost: 0.95, lineCost: 12 * 0.95 });
    expect(shoppingLineCost(row({ actualLineCost: 36, actualUnitCost: 18 }))).toEqual({ state: "costed", unitCost: 18, lineCost: 36 });
    expect(shoppingLineCost(row({ purchased: false }))).toEqual({ state: "not-bought" });
    // A recorded zero cost is a cost, not a missing one.
    expect(shoppingLineCost(row({ actualLineCost: 0 }))).toEqual({ state: "costed", unitCost: null, lineCost: 0 });
  });

  it("leaves the actual total as before and names the missing line", () => {
    const rows = [row({ itemName: "Toilet paper", actualLineCost: 11.4 }), row({ itemName: "Dishwasher tablets", actualLineCost: 36 }), row()].map((line) => ({
      ...line,
      propertyId: "p",
      suburb: "",
      itemId: line.itemName,
      category: "c",
      supplier: null,
      unit: "unit",
      onHand: 0,
      parLevel: 0,
      reorderThreshold: 0,
      needed: 3,
      plannedQty: 3,
      include: true,
    }));
    const totals = computeShoppingRunTotals(rows, { method: "CLEANER_PERSONAL_CARD", paidByScope: "CLEANER", receipts: [] });
    expect(totals.actualTotalCost).toBeCloseTo(47.4, 6);
    expect(totals.reimbursableCleanerAmount).toBeCloseTo(47.4, 6);
    const coverage = shoppingCostCoverage(rows);
    expect(coverage).toMatchObject({ boughtLines: 3, costedLines: 2 });
    expect(describeMissingCosts(coverage)).toBe("Hand wash refill ×3 for Bondi Beach House");
  });
});

describe("reimbursement approval rule", () => {
  it("needs the approver, and a receipt or a typed note, only when approving", () => {
    expect(reimbursementApprovalRefusal({ from: "PENDING_APPROVAL", to: "READY", receiptCount: 0, approval: { actorId: "a" } })?.code).toBe("RECEIPT_REQUIRED");
    expect(reimbursementApprovalRefusal({ from: "PENDING_APPROVAL", to: "REIMBURSED", receiptCount: 0, approval: { actorId: "a", overrideNote: "  " } })?.code).toBe("RECEIPT_REQUIRED");
    expect(reimbursementApprovalRefusal({ from: "PENDING_APPROVAL", to: "READY", receiptCount: 0, approval: { actorId: "a", overrideNote: "Receipt lost" } })).toBeNull();
    expect(reimbursementApprovalRefusal({ from: "PENDING_APPROVAL", to: "READY", receiptCount: 1, approval: { actorId: "a" } })).toBeNull();
    expect(reimbursementApprovalRefusal({ from: "PENDING_APPROVAL", to: "READY", receiptCount: 1, approval: null })?.code).toBe("APPROVER_REQUIRED");
    expect(reimbursementApprovalRefusal({ from: "READY", to: "READY", receiptCount: 0, approval: null })).toBeNull();
    expect(reimbursementApprovalRefusal({ from: "PENDING_APPROVAL", to: "NOT_APPLICABLE", receiptCount: 0, approval: null })).toBeNull();
  });
});
