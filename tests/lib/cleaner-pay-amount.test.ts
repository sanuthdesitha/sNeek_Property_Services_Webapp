/**
 * Owner rule 2026-11-13 — the pure cleaner pay rules: the field default is
 * the requested amount, the client charge is a separate labelled view, the
 * server decision refuses more than requested without an administrator
 * override and a reason, and the "paid above request" review flag. Also: no
 * cleaner-facing surface reads the client charge.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanerPayFieldDefault,
  cleanerRequestedAmount,
  clientChargeView,
  decideCleanerPayAmount,
  isPaidAboveRequest,
} from "@/lib/payroll/cleaner-pay-amount";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";

describe("normalizePayAdjustmentAmounts keeps the two amounts apart", () => {
  it.each([
    ["no client approval", null, null],
    ["client approved higher", { status: "APPROVED", amount: 60, counterAmount: null }, 60],
    ["client approved lower", { status: "APPROVED", amount: 30, counterAmount: null }, 30],
    ["counter-offer open", { status: "COUNTERED", amount: 60, counterAmount: 50 }, 60],
    ["counter-offer accepted", { status: "APPROVED", amount: 50, counterAmount: null }, 50],
  ] as const)("the cleaner amount stays the requested amount when %s", (_label, approval, clientAmount) => {
    const result = normalizePayAdjustmentAmounts({ requestedAmount: 40 }, approval as never);
    expect(result.primaryDisplayAmount).toBe(40);
    expect(result.cleanerRequestedAmount).toBe(40);
    expect(result.primaryDisplayAmountSource).toBe("CLEANER_REQUESTED");
    expect(result.clientRequestedAmount).toBe(clientAmount);
  });

  it("does not turn a missing requested amount into zero", () => {
    expect(normalizePayAdjustmentAmounts({ requestedAmount: null }).primaryDisplayAmount).toBeNull();
    expect(cleanerRequestedAmount({ requestedAmount: undefined })).toBeNull();
    expect(cleanerPayFieldDefault({ requestedAmount: null })).toBe("");
  });

  it("formats the field default from the requested amount", () => {
    expect(cleanerPayFieldDefault({ requestedAmount: 22.666 })).toBe("22.67");
  });
});

describe("clientChargeView", () => {
  it("labels each client state, read only", () => {
    expect(clientChargeView(null)).toBeNull();
    expect(clientChargeView({ status: "APPROVED", amount: 60 })?.label).toBe("Client charge approved: $60.00");
    expect(clientChargeView({ status: "COUNTERED", amount: 60, counterAmount: 50 })?.label).toBe("Client counter-offer: $50.00");
    expect(clientChargeView({ status: "PENDING", amount: 60 })?.label).toBe("Client charge awaiting approval: $60.00");
    expect(clientChargeView({ status: "DECLINED", amount: 60 })?.kind).toBe("DECLINED");
  });

  it("says the amount is unknown instead of $0.00", () => {
    expect(clientChargeView({ status: "COUNTERED", amount: 60, counterAmount: null })?.label).toBe("Client counter-offer: amount unknown");
  });
});

describe("decideCleanerPayAmount", () => {
  const base = { requestedAmount: 40, callerIsAdministrator: false };

  it("defaults to the requested amount when none is sent", () => {
    expect(decideCleanerPayAmount({ ...base, proposedAmount: undefined })).toEqual({ ok: true, amount: 40, aboveRequest: false, overrideReason: null });
  });

  it("refuses to invent an amount when the requested amount is missing", () => {
    expect(decideCleanerPayAmount({ ...base, requestedAmount: null, proposedAmount: undefined })).toMatchObject({ ok: false, code: "REQUESTED_AMOUNT_UNKNOWN" });
  });

  it("allows the requested amount and less", () => {
    expect(decideCleanerPayAmount({ ...base, proposedAmount: 40 })).toMatchObject({ ok: true, amount: 40 });
    expect(decideCleanerPayAmount({ ...base, proposedAmount: 12.345 })).toMatchObject({ ok: true, amount: 12.35 });
    // Sub-cent noise is not "more".
    expect(decideCleanerPayAmount({ ...base, proposedAmount: 40.001 })).toMatchObject({ ok: true });
  });

  it("refuses more for a non-administrator, even with the override flag", () => {
    expect(decideCleanerPayAmount({ ...base, proposedAmount: 60, overrideAboveRequest: true, overrideReason: "x" })).toMatchObject({ ok: false, status: 403, code: "ABOVE_REQUEST" });
  });

  it("refuses more for an administrator without the override flag", () => {
    expect(decideCleanerPayAmount({ ...base, callerIsAdministrator: true, proposedAmount: 60 })).toMatchObject({ ok: false, status: 403 });
  });

  it("needs a reason with the override", () => {
    expect(decideCleanerPayAmount({ ...base, callerIsAdministrator: true, proposedAmount: 60, overrideAboveRequest: true })).toMatchObject({ ok: false, status: 400, code: "OVERRIDE_REASON_REQUIRED" });
  });

  it("allows an administrator override with a reason", () => {
    expect(decideCleanerPayAmount({ ...base, callerIsAdministrator: true, proposedAmount: 60, overrideAboveRequest: true, overrideReason: " Agreed " })).toEqual({ ok: true, amount: 60, aboveRequest: true, overrideReason: "Agreed" });
  });

  it("treats a positive amount on a deduction as more than requested", () => {
    expect(decideCleanerPayAmount({ ...base, requestedAmount: -20, proposedAmount: 20 })).toMatchObject({ ok: false, code: "ABOVE_REQUEST" });
  });
});

describe("isPaidAboveRequest", () => {
  const approved = { status: "APPROVED", requestedAmount: 40, approvedAmount: 60, includedInPayrollRunId: null, includedInCleanerInvoiceId: null };
  it("flags approved, unpaid rows above the request", () => expect(isPaidAboveRequest(approved)).toBe(true));
  it("ignores paid rows, pending rows, equal and lower amounts, and unknowns", () => {
    expect(isPaidAboveRequest({ ...approved, includedInPayrollRunId: "run" })).toBe(false);
    expect(isPaidAboveRequest({ ...approved, includedInCleanerInvoiceId: "inv" })).toBe(false);
    expect(isPaidAboveRequest({ ...approved, status: "PENDING" })).toBe(false);
    expect(isPaidAboveRequest({ ...approved, approvedAmount: 40 })).toBe(false);
    expect(isPaidAboveRequest({ ...approved, approvedAmount: 35 })).toBe(false);
    expect(isPaidAboveRequest({ ...approved, approvedAmount: null })).toBe(false);
  });
});

describe("the cleaner never sees the client charge", () => {
  const ROOTS = ["app/api/cleaner", "components/v2/cleaner", "app/v2/cleaner"];
  // Shopping runs carry their own unrelated `clientChargeStatus` (a shopping
  // reimbursement), so the pay-request client charge names are listed exactly.
  const CLIENT_CHARGE = /clientApproval|clientRequestedAmount|clientChargeView|payClientCharge|counterAmount|client-approvals|normalizePayAdjustmentAmounts|cleaner-pay-amount/;

  function sourceFiles(dir: string): string[] {
    const full = path.join(process.cwd(), dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(child);
      return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
    });
  }

  it("no cleaner route, page or component reads the client approval or its amounts", () => {
    const files = ROOTS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((file) => CLIENT_CHARGE.test(fs.readFileSync(path.join(process.cwd(), file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the cleaner pay request payload lists requested and approved pay, and nothing of the client", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/cleaner/pay-adjustments/route.ts"), "utf8");
    expect(source).toMatch(/requestedAmount: row\.requestedAmount/);
    expect(source).toMatch(/approvedAmount: row\.approvedAmount/);
  });
});
