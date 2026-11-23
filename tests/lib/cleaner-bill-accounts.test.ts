import { describe, expect, it } from "vitest";
import { CLEANER_BILL_ACCOUNT_REFUSAL, cleanerBillLineKind, isValidXeroAccountCode, planCleanerBillAccounts } from "@/lib/xero/cleaner-bill-accounts";

const lines = [
  { kind: "CLEANING", category: "LABOUR", description: "12 Nov · Bondi" },
  { kind: "CLEANING", category: "REIMBURSEMENT", description: "Extra · parking" },
  { kind: "INSPECTION", category: "INSPECTION", description: "QA inspection · 12 Nov" },
  { kind: "CLEANING", description: "Shopping reimbursement · Coles run" },
  { kind: "INSPECTION", description: "Travel" },
  { description: "Old line" },
];

describe("Xero accounts of a cleaner bill", () => {
  it("refuses when no cleaning work account is chosen, whatever the optional accounts say (never 400)", () => {
    expect(planCleanerBillAccounts(lines, {})).toEqual({ ok: false, reason: CLEANER_BILL_ACCOUNT_REFUSAL });
    expect(planCleanerBillAccounts(lines, { cleanerBillAccountCode: "  ", cleanerBillReimbursementAccountCode: "620" })).toMatchObject({ ok: false });
    expect(planCleanerBillAccounts(lines, { cleanerBillAccountCode: "bad code!" })).toMatchObject({ ok: false });
  });

  it("uses the cleaning work account for every line when only it is set", () => {
    const plan = planCleanerBillAccounts(lines, { cleanerBillAccountCode: "477" });
    expect(plan.ok && plan.codes).toEqual(["477", "477", "477", "477", "477", "477"]);
  });

  it("sends inspections and reimbursements to their own accounts when set, reading older snapshots too", () => {
    const plan = planCleanerBillAccounts(lines, { cleanerBillAccountCode: "477", cleanerBillInspectionAccountCode: "478", cleanerBillReimbursementAccountCode: "620" });
    expect(plan.ok && plan.codes).toEqual(["477", "620", "478", "620", "478", "477"]);
  });

  it("classifies lines by the stamped category, then the older kind and description", () => {
    expect(lines.map(cleanerBillLineKind)).toEqual(["LABOUR", "REIMBURSEMENT", "INSPECTION", "REIMBURSEMENT", "INSPECTION", "LABOUR"]);
  });

  it("accepts Xero-style account codes and an empty value (cleared), nothing else", () => {
    expect(["", "400", "477", "6-1000", "WAGES.01"].every(isValidXeroAccountCode)).toBe(true);
    expect(["has space", "toolongcode1", "4$0"].some(isValidXeroAccountCode)).toBe(false);
  });
});
