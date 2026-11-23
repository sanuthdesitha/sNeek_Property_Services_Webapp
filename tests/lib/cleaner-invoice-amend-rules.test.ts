import { describe, expect, it } from "vitest";
import { amendPermission, describeAmendment, PAID_AMEND_REFUSAL, planAmendment, readStoredLines } from "@/lib/cleaner/invoice-amend-rules";

const facts = (status: string, extra: Partial<{ xeroBillId: string | null; paidAt: string | null; paidAmount: number | null }> = {}) => ({ status, xeroBillId: null, paidAt: null, paidAmount: null, ...extra });
const lineData = {
  lines: [
    { kind: "CLEANING", category: "LABOUR", description: "12 Nov · Bondi", quantity: 1, unitAmount: 120 },
    { kind: "CLEANING", category: "REIMBURSEMENT", description: "Extra · parking", quantity: 1, unitAmount: 12 },
    { kind: "CLEANING", category: "LABOUR", description: "Shopping time · Coles", quantity: 2, unitAmount: 15.5 },
  ],
  jobIds: ["j1"],
};

describe("who may amend a submitted cleaner invoice", () => {
  it("lets ADMIN and OPS_MANAGER amend a submitted invoice", () => {
    expect(amendPermission(facts("SUBMITTED"), "ADMIN")).toEqual({ ok: true, needsXeroUpdate: false });
    expect(amendPermission(facts("SUBMITTED"), "OPS_MANAGER")).toEqual({ ok: true, needsXeroUpdate: false });
    expect(amendPermission(facts("SUBMITTED"), "CLEANER")).toMatchObject({ ok: false, status: 403 });
  });

  it("keeps approved money with an administrator, and flags a Xero bill as needing an update", () => {
    expect(amendPermission(facts("APPROVED"), "OPS_MANAGER")).toMatchObject({ ok: false, status: 403 });
    expect(amendPermission(facts("APPROVED"), "ADMIN")).toEqual({ ok: true, needsXeroUpdate: false });
    expect(amendPermission(facts("XERO_PUSHED", { xeroBillId: "bill" }), "ADMIN")).toEqual({ ok: true, needsXeroUpdate: true });
    expect(amendPermission(facts("XERO_PUSHED", { xeroBillId: "bill" }), "OPS_MANAGER")).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses paid invoices with the pay-adjustment route, and every handed-back or in-flight state", () => {
    expect(amendPermission(facts("PAID"), "ADMIN")).toEqual({ ok: false, status: 409, reason: PAID_AMEND_REFUSAL });
    expect(amendPermission(facts("APPROVED", { paidAmount: 0 }), "ADMIN")).toMatchObject({ ok: false, reason: PAID_AMEND_REFUSAL });
    for (const status of ["PAID_CLAIMED", "XERO_EXPORTING", "SENDING", "CHANGES_REQUESTED", "VOID", "WEIRD"]) {
      expect(amendPermission(facts(status), "ADMIN"), status).toMatchObject({ ok: false, status: 409 });
    }
  });
});

describe("planning an amendment", () => {
  const base = { lineData, storedTotal: 163, storedHours: 3.5, hours: null, note: null };

  it("changes, removes and adds lines, keeps stored fields, and moves the total by the change in cents", () => {
    const result = planAmendment({
      ...base,
      lines: [
        { sourceIndex: 0, description: "12 Nov · Bondi", quantity: 1, unitAmount: 100 },
        { sourceIndex: 2, description: "Shopping time · Coles", quantity: 1.5, unitAmount: 15.5 },
        { sourceIndex: null, description: "Travel", quantity: 1, unitAmount: 15, category: "REIMBURSEMENT" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan } = result;
    expect(plan.beforeTotal).toBe(163);
    // 163 - 20 (line 1) - 12 (removed) - 7.75 (line 3) + 15 (added) = 138.25
    expect(plan.afterTotal).toBe(138.25);
    expect(plan.afterLines[0]).toMatchObject({ kind: "CLEANING", category: "LABOUR", unitAmount: 100, amendedByOffice: true });
    expect(plan.afterLines[2]).toMatchObject({ kind: "CLEANING", category: "REIMBURSEMENT", description: "Travel", addedByOffice: true });
    expect(plan.changes.map((change) => change.type)).toEqual(["REMOVED", "CHANGED", "CHANGED", "ADDED"]);
    const words = describeAmendment(plan);
    expect(words).toContain("Removed “Extra · parking” (was $12.00)");
    expect(words).toContain("Changed “12 Nov · Bondi”: unit amount $120.00 → $100.00; line $120.00 → $100.00");
    expect(words).toContain("Added “Travel”: $15.00");
    expect(words[words.length - 1]).toBe("Total $163.00 → $138.25");
  });

  it("keeps a stored total that differed from its lines (never silently recomputed)", () => {
    const result = planAmendment({ ...base, storedTotal: 170, lines: [
      { sourceIndex: 0, description: "12 Nov · Bondi", quantity: 1, unitAmount: 110 },
      { sourceIndex: 1, description: "Extra · parking", quantity: 1, unitAmount: 12 },
      { sourceIndex: 2, description: "Shopping time · Coles", quantity: 2, unitAmount: 15.5 },
    ] });
    expect(result.ok && result.plan.afterTotal).toBe(160);
  });

  it("refuses nothing-changed, bad numbers, stale line indexes, unreadable lines and a negative total", () => {
    const same = lineData.lines.map((line, index) => ({ sourceIndex: index, description: line.description, quantity: line.quantity, unitAmount: line.unitAmount }));
    expect(planAmendment({ ...base, lines: same })).toMatchObject({ ok: false, reason: expect.stringContaining("Nothing was changed") });
    expect(planAmendment({ ...base, lines: same, hours: 3 })).toMatchObject({ ok: true });
    expect(planAmendment({ ...base, lines: [{ ...same[0], quantity: 0 }] })).toMatchObject({ ok: false });
    expect(planAmendment({ ...base, lines: [{ ...same[0], unitAmount: Number.NaN }] })).toMatchObject({ ok: false });
    expect(planAmendment({ ...base, lines: [{ ...same[0], sourceIndex: 7 }] })).toMatchObject({ ok: false, reason: expect.stringContaining("changed since") });
    expect(planAmendment({ ...base, lines: [same[0], { ...same[0] }] })).toMatchObject({ ok: false });
    expect(planAmendment({ ...base, lines: [] })).toMatchObject({ ok: false });
    expect(planAmendment({ ...base, lineData: { lines: [{ description: "x" }] }, lines: [{ sourceIndex: null, description: "y", quantity: 1, unitAmount: 1 }] })).toMatchObject({ ok: false, reason: expect.stringContaining("no readable amount") });
    expect(planAmendment({ ...base, lines: [{ ...same[0], unitAmount: -500 }] })).toMatchObject({ ok: false, reason: expect.stringContaining("below $0.00") });
  });

  it("reads stored lines without inventing amounts", () => {
    expect(readStoredLines({ lines: [{ description: "a", unitAmount: 5 }, { description: "b", unitAmount: "5" }] })).toMatchObject({ unreadable: 1, lines: [{ description: "a", quantity: 1, unitAmount: 5 }] });
    expect(readStoredLines(null)).toEqual({ lines: [], unreadable: 0 });
  });
});
