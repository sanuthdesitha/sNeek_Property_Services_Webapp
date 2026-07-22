import { describe, it, expect } from "vitest";
import {
  ReworkInvariantError,
  SELF_REWORK_MINUTES_HARD_CAP,
  assertAdjustmentProvenance,
  assertDeductionMatchesPayment,
  assertPendingNotInPayroll,
  assertReassignedReworkMoney,
  assertReworkInvoiceablePayee,
  assertSelfReworkMinutes,
  assertSingleDeduction,
  guardInvariant,
} from "@/lib/qa/rework-invariants";

const ORIGINAL = "cleaner-original";
const OTHER = "cleaner-other";

function expectViolation(fn: () => void, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ReworkInvariantError);
    expect((err as ReworkInvariantError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} violation, none thrown`);
}

/* ── 1. invoiceable ⇔ payee ≠ original cleaner ───────────────────────────── */
describe("assertReworkInvoiceablePayee", () => {
  it("same cleaner at $0 is valid", () => {
    expect(() =>
      assertReworkInvoiceablePayee({ originalCleanerId: ORIGINAL, payeeCleanerId: ORIGINAL, payAmount: 0 })
    ).not.toThrow();
  });

  it("no payee at $0 is valid (unassigned rework)", () => {
    expect(() =>
      assertReworkInvoiceablePayee({ originalCleanerId: ORIGINAL, payeeCleanerId: null, payAmount: 0 })
    ).not.toThrow();
  });

  it("different cleaner with pay is valid", () => {
    expect(() =>
      assertReworkInvoiceablePayee({
        originalCleanerId: ORIGINAL,
        payeeCleanerId: OTHER,
        payAmount: 45,
        deductFromCleanerId: ORIGINAL,
      })
    ).not.toThrow();
  });

  it("TAMPER: paying the original cleaner for their own rework is rejected", () => {
    expectViolation(
      () =>
        assertReworkInvoiceablePayee({ originalCleanerId: ORIGINAL, payeeCleanerId: ORIGINAL, payAmount: 45 }),
      "INVOICEABLE_PAYEE_MISMATCH"
    );
  });

  it("TAMPER: a $0.01 payment to the original cleaner is still rejected", () => {
    expectViolation(
      () =>
        assertReworkInvoiceablePayee({ originalCleanerId: ORIGINAL, payeeCleanerId: ORIGINAL, payAmount: 0.01 }),
      "INVOICEABLE_PAYEE_MISMATCH"
    );
  });

  it("TAMPER: reassigning to another cleaner for $0 is rejected", () => {
    expectViolation(
      () => assertReworkInvoiceablePayee({ originalCleanerId: ORIGINAL, payeeCleanerId: OTHER, payAmount: 0 }),
      "INVOICEABLE_PAYEE_MISMATCH"
    );
  });

  it("TAMPER: deducting from someone other than the original cleaner is rejected", () => {
    expectViolation(
      () =>
        assertReworkInvoiceablePayee({
          originalCleanerId: ORIGINAL,
          payeeCleanerId: OTHER,
          payAmount: 45,
          deductFromCleanerId: "cleaner-third-party",
        }),
      "INVOICEABLE_PAYEE_MISMATCH"
    );
  });
});

/* ── 2. deduction === payment ────────────────────────────────────────────── */
describe("assertDeductionMatchesPayment", () => {
  it("equal and opposite passes", () => {
    expect(() => assertDeductionMatchesPayment({ payAmount: 45, deductionAmount: -45 })).not.toThrow();
  });

  it("cents-level equality passes", () => {
    expect(() => assertDeductionMatchesPayment({ payAmount: 45.55, deductionAmount: -45.55 })).not.toThrow();
  });

  it("TAMPER: under-deducting is rejected", () => {
    expectViolation(
      () => assertDeductionMatchesPayment({ payAmount: 45, deductionAmount: -20 }),
      "DEDUCTION_PAYMENT_MISMATCH"
    );
  });

  it("TAMPER: over-deducting is rejected", () => {
    expectViolation(
      () => assertDeductionMatchesPayment({ payAmount: 45, deductionAmount: -60 }),
      "DEDUCTION_PAYMENT_MISMATCH"
    );
  });

  it("TAMPER: a POSITIVE 'deduction' (a second payment) is rejected", () => {
    expectViolation(
      () => assertDeductionMatchesPayment({ payAmount: 45, deductionAmount: 45 }),
      "DEDUCTION_PAYMENT_MISMATCH"
    );
  });
});

/* ── 3. deduction applied at most once ───────────────────────────────────── */
describe("assertSingleDeduction", () => {
  it("first application passes", () => {
    expect(() => assertSingleDeduction({ alreadyApplied: false, existingDeductionCount: 0 })).not.toThrow();
  });

  it("TAMPER: re-applying an already-applied deduction is rejected", () => {
    expectViolation(
      () => assertSingleDeduction({ alreadyApplied: true, existingDeductionCount: 0 }),
      "DOUBLE_DEDUCTION"
    );
  });

  it("TAMPER: an existing (source, sourceKey) row blocks a second deduction", () => {
    expectViolation(
      () => assertSingleDeduction({ alreadyApplied: false, existingDeductionCount: 1 }),
      "DOUBLE_DEDUCTION"
    );
  });
});

/* ── 4. provenance ───────────────────────────────────────────────────────── */
describe("assertAdjustmentProvenance", () => {
  it("source + sourceKey passes", () => {
    expect(() =>
      assertAdjustmentProvenance({ source: "REWORK_DEDUCTION", sourceKey: "rework-deduction:job-1" })
    ).not.toThrow();
  });

  it("TAMPER: a missing sourceKey is rejected", () => {
    expectViolation(
      () => assertAdjustmentProvenance({ source: "REWORK_DEDUCTION", sourceKey: null }),
      "MISSING_ADJUSTMENT_PROVENANCE"
    );
  });

  it("TAMPER: a blank source is rejected", () => {
    expectViolation(
      () => assertAdjustmentProvenance({ source: "   ", sourceKey: "rework-deduction:job-1" }),
      "MISSING_ADJUSTMENT_PROVENANCE"
    );
  });
});

/* ── 5. nothing enters payroll while PENDING ─────────────────────────────── */
describe("assertPendingNotInPayroll", () => {
  it("a clean PENDING row passes", () => {
    expect(() =>
      assertPendingNotInPayroll({ status: "PENDING", approvedAmount: null, includedInPayrollRunId: null })
    ).not.toThrow();
  });

  it("an APPROVED row in a payroll run passes (that is the point)", () => {
    expect(() =>
      assertPendingNotInPayroll({ status: "APPROVED", approvedAmount: -45, includedInPayrollRunId: "run-1" })
    ).not.toThrow();
  });

  it("TAMPER: a PENDING row stamped with a payroll run is rejected", () => {
    expectViolation(
      () =>
        assertPendingNotInPayroll({ status: "PENDING", approvedAmount: null, includedInPayrollRunId: "run-1" }),
      "PENDING_IN_PAYROLL"
    );
  });

  it("TAMPER: a PENDING row carrying an approved amount is rejected", () => {
    expectViolation(
      () => assertPendingNotInPayroll({ status: "PENDING", approvedAmount: -45, includedInPayrollRunId: null }),
      "PENDING_IN_PAYROLL"
    );
  });
});

/* ── 6. self-rework minutes bounded by the on-site window ────────────────── */
describe("assertSelfReworkMinutes", () => {
  it("a claim inside the window passes", () => {
    expect(() => assertSelfReworkMinutes({ minutes: 20, onSiteMinutes: 45 })).not.toThrow();
  });

  it("the tolerance allowance passes", () => {
    expect(() => assertSelfReworkMinutes({ minutes: 55, onSiteMinutes: 45 })).not.toThrow();
  });

  it("TAMPER: claiming more than the window + tolerance is rejected", () => {
    expectViolation(
      () => assertSelfReworkMinutes({ minutes: 120, onSiteMinutes: 45 }),
      "SELF_REWORK_MINUTES_OUT_OF_BOUNDS"
    );
  });

  it("TAMPER: negative minutes are rejected", () => {
    expectViolation(
      () => assertSelfReworkMinutes({ minutes: -5, onSiteMinutes: 45 }),
      "SELF_REWORK_MINUTES_OUT_OF_BOUNDS"
    );
  });

  it("an unmeasured window falls back to the hard cap", () => {
    expect(() => assertSelfReworkMinutes({ minutes: SELF_REWORK_MINUTES_HARD_CAP, onSiteMinutes: null })).not.toThrow();
    expectViolation(
      () => assertSelfReworkMinutes({ minutes: SELF_REWORK_MINUTES_HARD_CAP + 1, onSiteMinutes: null }),
      "SELF_REWORK_MINUTES_OUT_OF_BOUNDS"
    );
  });
});

/* ── composite + guard ───────────────────────────────────────────────────── */
describe("assertReassignedReworkMoney", () => {
  const valid = {
    originalCleanerId: ORIGINAL,
    payeeCleanerId: OTHER,
    payAmount: 45,
    deductFromCleanerId: ORIGINAL,
    deductionAmount: -45,
    alreadyApplied: false,
    existingDeductionCount: 0,
    adjustment: {
      source: "REWORK_DEDUCTION",
      sourceKey: "rework-deduction:job-1",
      status: "PENDING",
      approvedAmount: null,
      includedInPayrollRunId: null,
    },
  };

  it("the happy path passes every invariant", () => {
    expect(() => assertReassignedReworkMoney(valid)).not.toThrow();
  });

  it("TAMPER: mismatched deduction fails the composite", () => {
    expectViolation(
      () => assertReassignedReworkMoney({ ...valid, deductionAmount: -10 }),
      "DEDUCTION_PAYMENT_MISMATCH"
    );
  });

  it("TAMPER: PENDING + approved amount fails the composite", () => {
    expectViolation(
      () =>
        assertReassignedReworkMoney({
          ...valid,
          adjustment: { ...valid.adjustment, approvedAmount: -45 },
        }),
      "PENDING_IN_PAYROLL"
    );
  });
});

describe("guardInvariant", () => {
  it("returns the assertion result when it holds", async () => {
    await expect(guardInvariant(() => 42)).resolves.toBe(42);
  });

  it("rethrows the invariant error (audit is best-effort and never masks it)", async () => {
    await expect(
      guardInvariant(() =>
        assertReworkInvoiceablePayee({ originalCleanerId: ORIGINAL, payeeCleanerId: ORIGINAL, payAmount: 45 })
      )
    ).rejects.toThrow(ReworkInvariantError);
  });

  it("rethrows non-invariant errors untouched", async () => {
    await expect(
      guardInvariant(() => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
