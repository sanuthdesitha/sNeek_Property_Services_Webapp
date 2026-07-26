import { describe, it, expect } from "vitest";
import {
  computeQaAssignmentPay,
  isQaAssignmentAvailableForSettlement,
  normalizeQaPayMode,
  qaAssignmentCountsTowardPay,
  qaAssignmentSettlementAmount,
  sumQaPay,
  type QaPayAssignmentInput,
  type QaPaySettingsInput,
} from "@/lib/finance/qa-pay";

/** Baseline settings: HOURLY $40/hr, 1.5h per inspection, $25 fixed fallback. */
const SETTINGS: QaPaySettingsInput = {
  defaultMode: "HOURLY",
  defaultFixedAmount: 25,
  defaultHourlyRate: 40,
  defaultHoursPerInspection: 1.5,
};

function assignment(over: Partial<QaPayAssignmentInput> = {}): QaPayAssignmentInput {
  return {
    payMode: null,
    payAmount: null,
    payHourlyRate: null,
    payHoursAllocated: null,
    onSiteMinutes: null,
    ...over,
  };
}

describe("normalizeQaPayMode — what counts as an override vs 'inherit'", () => {
  it("accepts the three real modes, case-insensitively", () => {
    expect(normalizeQaPayMode("FIXED")).toBe("FIXED");
    expect(normalizeQaPayMode("hourly")).toBe("HOURLY");
    expect(normalizeQaPayMode(" None ")).toBe("NONE");
  });

  it("treats DEFAULT, empty, null and junk as 'inherit the setting'", () => {
    // The column is free text, so an unparseable value must NOT decide pay.
    expect(normalizeQaPayMode("DEFAULT")).toBeNull();
    expect(normalizeQaPayMode("")).toBeNull();
    expect(normalizeQaPayMode(null)).toBeNull();
    expect(normalizeQaPayMode(undefined)).toBeNull();
    expect(normalizeQaPayMode("PIZZA")).toBeNull();
    expect(normalizeQaPayMode(42)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MODE precedence: assignment override → settings default
// ─────────────────────────────────────────────────────────────────────────
describe("computeQaAssignmentPay — mode precedence", () => {
  it("uses the settings default when the assignment has no override", () => {
    const pay = computeQaAssignmentPay({ assignment: assignment(), settings: SETTINGS });
    expect(pay.mode).toBe("HOURLY");
  });

  it("lets a per-assignment override beat the settings default (HOURLY → FIXED)", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "FIXED", payAmount: 60 }),
      settings: SETTINGS,
    });
    expect(pay.mode).toBe("FIXED");
    expect(pay.amount).toBe(60);
  });

  it("lets a per-assignment override beat the settings default (FIXED → HOURLY)", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHourlyRate: 50, payHoursAllocated: 2 }),
      settings: { ...SETTINGS, defaultMode: "FIXED" },
    });
    expect(pay.mode).toBe("HOURLY");
    expect(pay.amount).toBe(100);
  });

  it("treats 'DEFAULT' on the assignment as inherit, not as a mode", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "DEFAULT" }),
      settings: { ...SETTINGS, defaultMode: "FIXED" },
    });
    expect(pay.mode).toBe("FIXED");
  });

  it("falls back to NONE when even the settings default is unreadable", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment(),
      settings: { ...SETTINGS, defaultMode: "GARBAGE" as any },
    });
    expect(pay.mode).toBe("NONE");
    expect(pay.amount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// NONE
// ─────────────────────────────────────────────────────────────────────────
describe("computeQaAssignmentPay — NONE (explicitly unpaid)", () => {
  it("pays zero and is NOT flagged as misconfigured", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "NONE", payAmount: 500, payHourlyRate: 90 }),
      inspector: { hourlyRate: 70 },
      settings: SETTINGS,
    });
    expect(pay).toEqual({
      amount: 0,
      mode: "NONE",
      basis: "NONE",
      hours: 0,
      rate: 0,
      source: "UNPAID",
      // An unpaid inspection is a decision, not a missing rate — the UI must not
      // nag "rate not set" at it.
      rateMissing: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FIXED amount precedence: assignment → settings
// ─────────────────────────────────────────────────────────────────────────
describe("computeQaAssignmentPay — FIXED amount precedence", () => {
  it("prefers the per-assignment amount", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "FIXED", payAmount: 72.5 }),
      settings: SETTINGS,
    });
    expect(pay.amount).toBe(72.5);
    expect(pay.source).toBe("ASSIGNMENT_FIXED");
  });

  it("falls back to the settings default amount", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "FIXED" }),
      settings: SETTINGS,
    });
    expect(pay.amount).toBe(25);
    expect(pay.source).toBe("SETTINGS_FIXED");
  });

  it("honours an explicit per-assignment 0 rather than inheriting", () => {
    // "This one inspection pays nothing" is a real admin decision and must not
    // silently become the $25 default.
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "FIXED", payAmount: 0 }),
      settings: SETTINGS,
    });
    expect(pay.amount).toBe(0);
    expect(pay.source).toBe("ASSIGNMENT_FIXED");
    expect(pay.rateMissing).toBe(false);
  });

  it("flags rateMissing when neither level configures an amount", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "FIXED" }),
      settings: { ...SETTINGS, defaultFixedAmount: 0 },
    });
    expect(pay.amount).toBe(0);
    expect(pay.rateMissing).toBe(true);
  });

  it("ignores hours entirely in FIXED mode", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "FIXED", payAmount: 80, payHoursAllocated: 9, onSiteMinutes: 600 }),
      settings: SETTINGS,
    });
    expect(pay.amount).toBe(80);
    expect(pay.hours).toBe(0);
    expect(pay.basis).toBe("NONE");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HOURLY rate precedence: assignment → inspector → settings
// ─────────────────────────────────────────────────────────────────────────
describe("computeQaAssignmentPay — HOURLY rate precedence (assignment → inspector → settings)", () => {
  const cases: Array<{
    label: string;
    assignmentRate: number | null;
    inspectorRate: number | null;
    settingsRate: number;
    expectRate: number;
    expectSource: string;
  }> = [
    {
      label: "all three set → assignment wins",
      assignmentRate: 55,
      inspectorRate: 45,
      settingsRate: 40,
      expectRate: 55,
      expectSource: "ASSIGNMENT_RATE",
    },
    {
      label: "no assignment rate → inspector wins",
      assignmentRate: null,
      inspectorRate: 45,
      settingsRate: 40,
      expectRate: 45,
      expectSource: "INSPECTOR_RATE",
    },
    {
      label: "no assignment or inspector rate → settings wins",
      assignmentRate: null,
      inspectorRate: null,
      settingsRate: 40,
      expectRate: 40,
      expectSource: "SETTINGS_RATE",
    },
    {
      label: "assignment rate set, inspector absent → assignment still wins",
      assignmentRate: 55,
      inspectorRate: null,
      settingsRate: 40,
      expectRate: 55,
      expectSource: "ASSIGNMENT_RATE",
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const pay = computeQaAssignmentPay({
        assignment: assignment({
          payMode: "HOURLY",
          payHourlyRate: c.assignmentRate,
          payHoursAllocated: 1,
        }),
        inspector: { hourlyRate: c.inspectorRate },
        settings: { ...SETTINGS, defaultHourlyRate: c.settingsRate },
      });
      expect(pay.rate).toBe(c.expectRate);
      expect(pay.source).toBe(c.expectSource);
      expect(pay.amount).toBe(c.expectRate);
    });
  }

  it("treats a zero / negative / non-finite rate at any level as 'not set' and keeps falling through", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHourlyRate: 0, payHoursAllocated: 2 }),
      inspector: { hourlyRate: Number.NaN },
      settings: { ...SETTINGS, defaultHourlyRate: 30 },
    });
    expect(pay.rate).toBe(30);
    expect(pay.source).toBe("SETTINGS_RATE");
  });

  it("flags rateMissing (and pays 0) when NO level has a usable rate", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHoursAllocated: 3 }),
      inspector: { hourlyRate: null },
      settings: { ...SETTINGS, defaultHourlyRate: 0 },
    });
    expect(pay.rateMissing).toBe(true);
    expect(pay.amount).toBe(0);
    // Hours still resolve — the missing piece is the rate, and the UI should say so.
    expect(pay.hours).toBe(3);
  });

  it("works with no inspector supplied at all", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHoursAllocated: 2 }),
      settings: SETTINGS,
    });
    expect(pay.rate).toBe(40);
    expect(pay.amount).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HOURLY hours precedence: allocated → actual on-site → settings default
// ─────────────────────────────────────────────────────────────────────────
describe("computeQaAssignmentPay — HOURLY hours precedence (allocated → actual → default)", () => {
  it("prefers the allocated hours over a longer on-site timer", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHoursAllocated: 1, onSiteMinutes: 180 }),
      settings: SETTINGS,
    });
    expect(pay.hours).toBe(1);
    expect(pay.basis).toBe("ALLOCATED");
    expect(pay.amount).toBe(40);
  });

  it("uses the on-site timer when no hours were allocated", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", onSiteMinutes: 45 }),
      settings: SETTINGS,
    });
    expect(pay.hours).toBe(0.75);
    expect(pay.basis).toBe("ACTUAL");
    expect(pay.amount).toBe(30);
  });

  it("prefers an explicitly passed actualHours over the raw onSiteMinutes", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", onSiteMinutes: 45 }),
      settings: SETTINGS,
      actualHours: 2,
    });
    expect(pay.hours).toBe(2);
    expect(pay.basis).toBe("ACTUAL");
    expect(pay.amount).toBe(80);
  });

  it("falls back to the settings default hours when there is no allocation and no timer", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY" }),
      settings: SETTINGS,
    });
    expect(pay.hours).toBe(1.5);
    expect(pay.basis).toBe("DEFAULT_HOURS");
    expect(pay.amount).toBe(60);
  });

  it("treats a 0/absent timer as 'no reading' and uses the default hours", () => {
    // An inspector who never started the timer did not work zero hours; paying
    // $0 off a missing reading would be silently wrong.
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", onSiteMinutes: 0 }),
      settings: SETTINGS,
    });
    expect(pay.hours).toBe(1.5);
    expect(pay.basis).toBe("DEFAULT_HOURS");
  });

  it("honours an explicit allocation of 0 hours (pays nothing, deliberately)", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHoursAllocated: 0, onSiteMinutes: 120 }),
      settings: SETTINGS,
    });
    expect(pay.hours).toBe(0);
    expect(pay.basis).toBe("ALLOCATED");
    expect(pay.amount).toBe(0);
  });

  it("pays 0 with basis DEFAULT_HOURS when nothing anywhere supplies hours", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHourlyRate: 50 }),
      settings: { ...SETTINGS, defaultHoursPerInspection: 0 },
    });
    expect(pay.hours).toBe(0);
    expect(pay.basis).toBe("DEFAULT_HOURS");
    expect(pay.amount).toBe(0);
    // The rate IS configured, so this is not a rate-missing situation.
    expect(pay.rateMissing).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Full precedence matrix — independent resolution per level
// ─────────────────────────────────────────────────────────────────────────
describe("computeQaAssignmentPay — the levels resolve INDEPENDENTLY", () => {
  it("pins hours on the assignment while the rate still flows from the inspector", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHoursAllocated: 2.5 }),
      inspector: { hourlyRate: 44 },
      settings: SETTINGS,
    });
    expect(pay.hours).toBe(2.5);
    expect(pay.basis).toBe("ALLOCATED");
    expect(pay.rate).toBe(44);
    expect(pay.source).toBe("INSPECTOR_RATE");
    expect(pay.amount).toBe(110);
  });

  it("pins the rate on the assignment while hours come from the on-site timer", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHourlyRate: 60, onSiteMinutes: 90 }),
      inspector: { hourlyRate: 44 },
      settings: SETTINGS,
    });
    expect(pay.rate).toBe(60);
    expect(pay.source).toBe("ASSIGNMENT_RATE");
    expect(pay.hours).toBe(1.5);
    expect(pay.basis).toBe("ACTUAL");
    expect(pay.amount).toBe(90);
  });
});

describe("computeQaAssignmentPay — rounding", () => {
  it("rounds to whole cents", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({ payMode: "HOURLY", payHourlyRate: 33.33, onSiteMinutes: 50 }),
      settings: SETTINGS,
    });
    // 50/60 = 0.8333…h; ×33.33 → 27.775 → 27.78
    expect(pay.amount).toBe(27.78);
    expect(Number.isFinite(pay.amount)).toBe(true);
  });

  it("never returns NaN from junk inputs", () => {
    const pay = computeQaAssignmentPay({
      assignment: assignment({
        payMode: "HOURLY",
        payHourlyRate: "abc" as any,
        payHoursAllocated: Number.POSITIVE_INFINITY,
      }),
      settings: SETTINGS,
    });
    expect(Number.isNaN(pay.amount)).toBe(false);
    // Infinity is not a usable allocation, so it falls through to the default.
    expect(pay.hours).toBe(1.5);
    expect(pay.rate).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Settlement / no-double-pay
// ─────────────────────────────────────────────────────────────────────────
describe("qaAssignmentCountsTowardPay — only COMPLETED work is payable", () => {
  it("admits COMPLETED and nothing else", () => {
    expect(qaAssignmentCountsTowardPay({ status: "COMPLETED" })).toBe(true);
    for (const status of ["OPEN", "ASSIGNED", "IN_PROGRESS", "CANCELLED", ""]) {
      expect(qaAssignmentCountsTowardPay({ status })).toBe(false);
    }
  });
});

describe("isQaAssignmentAvailableForSettlement — no double pay", () => {
  const completed = { id: "qa1", status: "COMPLETED" as const };

  it("an unsettled completed inspection is available", () => {
    expect(isQaAssignmentAvailableForSettlement({ ...completed })).toBe(true);
  });

  it("an incomplete inspection is never available", () => {
    expect(isQaAssignmentAvailableForSettlement({ id: "qa1", status: "IN_PROGRESS" })).toBe(false);
  });

  it("a payroll-stamped inspection is spent — no later run may pick it up", () => {
    expect(
      isQaAssignmentAvailableForSettlement({ ...completed, includedInPayrollRunId: "run-1" })
    ).toBe(false);
  });

  it("an invoice-stamped inspection is spent — no payroll run may pick it up either", () => {
    // The cross-rail guard: this is exactly how the same work gets paid twice.
    expect(
      isQaAssignmentAvailableForSettlement({ ...completed, includedInCleanerInvoiceId: "inv-1" })
    ).toBe(false);
  });

  it("the run that stamped it can still recompute it", () => {
    expect(
      isQaAssignmentAvailableForSettlement(
        { ...completed, includedInPayrollRunId: "run-1" },
        { includePayrollRunId: "run-1" }
      )
    ).toBe(true);
  });

  it("a DIFFERENT run may not, even when recomputing", () => {
    expect(
      isQaAssignmentAvailableForSettlement(
        { ...completed, includedInPayrollRunId: "run-1" },
        { includePayrollRunId: "run-2" }
      )
    ).toBe(false);
  });

  it("the invoice that stamped it can still re-render it", () => {
    expect(
      isQaAssignmentAvailableForSettlement(
        { ...completed, includedInCleanerInvoiceId: "inv-1" },
        { includeInvoiceId: "inv-1" }
      )
    ).toBe(true);
  });

  it("recomputing an invoice does NOT unlock a payroll-stamped row", () => {
    expect(
      isQaAssignmentAvailableForSettlement(
        { ...completed, includedInPayrollRunId: "run-1" },
        { includeInvoiceId: "inv-1" }
      )
    ).toBe(false);
  });

  it("a row settled by BOTH rails stays locked unless both are being recomputed", () => {
    const both = {
      ...completed,
      includedInPayrollRunId: "run-1",
      includedInCleanerInvoiceId: "inv-1",
    };
    expect(isQaAssignmentAvailableForSettlement(both, { includePayrollRunId: "run-1" })).toBe(false);
    expect(
      isQaAssignmentAvailableForSettlement(both, {
        includePayrollRunId: "run-1",
        includeInvoiceId: "inv-1",
      })
    ).toBe(true);
  });

  it("a run selecting twice cannot pick the same row up twice", () => {
    // Simulates the real loop: select → stamp → select again.
    const rows = [
      { id: "a", status: "COMPLETED" as const, includedInPayrollRunId: null as string | null },
      { id: "b", status: "COMPLETED" as const, includedInPayrollRunId: null as string | null },
    ];
    const firstPass = rows.filter((r) => isQaAssignmentAvailableForSettlement(r));
    expect(firstPass.map((r) => r.id)).toEqual(["a", "b"]);
    for (const r of firstPass) r.includedInPayrollRunId = "run-1";
    const secondPass = rows.filter((r) => isQaAssignmentAvailableForSettlement(r));
    expect(secondPass).toEqual([]);
  });
});

describe("qaAssignmentSettlementAmount — settled pay is frozen", () => {
  it("uses the frozen amount over a recomputed one", () => {
    // A rate change after the run must not retro-alter what was paid.
    expect(qaAssignmentSettlementAmount({ paySettledAmount: 60 }, 999)).toBe(60);
  });

  it("honours a frozen 0", () => {
    expect(qaAssignmentSettlementAmount({ paySettledAmount: 0 }, 40)).toBe(0);
  });

  it("computes live when nothing is frozen", () => {
    expect(qaAssignmentSettlementAmount({ paySettledAmount: null }, 40.005)).toBe(40.01);
    expect(qaAssignmentSettlementAmount({}, 12.3456)).toBe(12.35);
  });

  it("ignores a non-finite frozen value", () => {
    expect(qaAssignmentSettlementAmount({ paySettledAmount: Number.NaN }, 25)).toBe(25);
  });
});

describe("sumQaPay", () => {
  it("sums to whole cents and handles an empty list", () => {
    expect(sumQaPay([])).toBe(0);
    expect(sumQaPay([{ amount: 10.005 }, { amount: 20.004 }])).toBe(30.01);
  });
});
