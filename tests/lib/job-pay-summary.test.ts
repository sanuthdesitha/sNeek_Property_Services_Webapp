import { describe, it, expect } from "vitest";
import {
  computeJobPaySummary,
  deriveAdjustmentOrigin,
  describeAdjustment,
  isAdjustmentEditable,
  adjustmentSettlement,
  adjustmentDisplayAmount,
} from "@/lib/finance/job-pay-summary";

/**
 * Unit coverage for the canonical per-job pay summary (pay-transparency wave):
 *  • origin derivation from the (source, sourceKey) conventions;
 *  • the editability predicate (role × settlement);
 *  • approvedTotal vs pendingDelta separation;
 *  • PAYEE grouping — a QA credit written against a CLEANER'S job must land
 *    under the QA user, never inside the cleaner's total.
 */

const JOB = {
  jobType: "STANDARD_CLEAN" as any,
  estimatedHours: 2,
  isRework: false,
  reworkPayAmount: null,
};

function adj(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    cleanerId: "u1",
    status: "APPROVED",
    requestedAmount: 40,
    approvedAmount: 40,
    title: "Extra payment",
    source: null,
    sourceKey: null,
    requestedAt: new Date("2026-07-01T00:00:00Z"),
    reviewedAt: new Date("2026-07-02T00:00:00Z"),
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    ...over,
  } as any;
}

function summary(over: Record<string, unknown> = {}) {
  return computeJobPaySummary({ audience: "internal",
    job: JOB,
    assignments: [
      { userId: "u1", payRate: 50, removedAt: null, userName: "Cleaner One", userRole: "CLEANER", userHourlyRate: 30 },
    ],
    settings: {},
    adjustments: [],
    ...over,
  } as any);
}

describe("deriveAdjustmentOrigin — sourceKey conventions", () => {
  it("maps every automatic source to AUTOMATIC with a human label", () => {
    const cases: Array<[string, string]> = [
      ["REWORK_DEDUCTION", "rework deduction"],
      ["REWORK_TRANSFER_DEDUCTION", "rework transfer deduction"],
      ["REWORK_TRANSFER_CREDIT", "rework transfer credit"],
      ["QA_RECTIFICATION_PAY", "QA rectification pay"],
      ["RECTIFICATION_DEDUCTION", "rectification deduction"],
      ["STREAK_5", "5-clean streak bonus"],
      ["STREAK_10", "10-clean streak bonus"],
      ["MONTHLY_RANK_1", "monthly ranking bonus (1st)"],
      ["MONTHLY_RANK_2", "monthly ranking bonus (2nd)"],
    ];
    for (const [source, fragment] of cases) {
      const info = deriveAdjustmentOrigin(source, null);
      expect(info.origin).toBe("AUTOMATIC");
      expect(info.label).toBe(`Automatic — ${fragment}`);
    }
  });

  it("falls back to the sourceKey prefix when the source value is unknown", () => {
    for (const key of [
      "rework:job1",
      "rework-transfer:t1",
      "rect:i1",
      "rect:i1:ded",
      "streak5:u1:j1",
      "streak10:u1:j1",
      "monthly:2026-07:1",
    ]) {
      expect(deriveAdjustmentOrigin("FUTURE_SOURCE", key).origin).toBe("AUTOMATIC");
    }
  });

  it("treats null / legacy / unknown provenance as MANUAL", () => {
    expect(deriveAdjustmentOrigin(null, null)).toEqual({ origin: "MANUAL", label: "Manual" });
    expect(deriveAdjustmentOrigin("", "").origin).toBe("MANUAL");
    expect(deriveAdjustmentOrigin("SOMETHING_ELSE", "unknown:1").origin).toBe("MANUAL");
  });

  it("labels an admin correcting adjustment as MANUAL — correcting", () => {
    const info = deriveAdjustmentOrigin("ADMIN_CORRECTION", "correction:abc");
    expect(info.origin).toBe("MANUAL");
    expect(info.label).toBe("Manual — correcting adjustment");
  });
});

describe("editability predicate — status × settled × role", () => {
  it("is editable for admin/ops on an unsettled row at ANY status", () => {
    for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
      for (const role of ["ADMIN", "OPS_MANAGER"]) {
        expect(isAdjustmentEditable(adj({ status }), role)).toBe(true);
      }
    }
  });

  it("is never editable for a non-admin role", () => {
    for (const role of ["CLEANER", "QA_INSPECTOR", "CLIENT", null, undefined]) {
      expect(isAdjustmentEditable(adj(), role as any)).toBe(false);
    }
  });

  it("is never editable once EITHER settlement rail has stamped it", () => {
    expect(isAdjustmentEditable(adj({ includedInPayrollRunId: "run1" }), "ADMIN")).toBe(false);
    expect(isAdjustmentEditable(adj({ includedInCleanerInvoiceId: "inv1" }), "ADMIN")).toBe(false);
  });

  it("reports WHICH rail settled it (payroll wins, mirroring the 409)", () => {
    expect(adjustmentSettlement(adj({ includedInPayrollRunId: "run1" }))?.rail).toBe("PAYROLL");
    expect(adjustmentSettlement(adj({ includedInCleanerInvoiceId: "inv1" }))?.rail).toBe("INVOICE");
    expect(
      adjustmentSettlement(adj({ includedInPayrollRunId: "run1", includedInCleanerInvoiceId: "inv1" }))?.rail
    ).toBe("PAYROLL");
    expect(adjustmentSettlement(adj())).toBeNull();
  });
});

describe("display amount", () => {
  it("uses the APPROVED amount for approved rows and the requested amount otherwise", () => {
    expect(adjustmentDisplayAmount({ status: "APPROVED", approvedAmount: 25, requestedAmount: 40 })).toBe(25);
    expect(adjustmentDisplayAmount({ status: "PENDING", approvedAmount: null, requestedAmount: 40 })).toBe(40);
    expect(adjustmentDisplayAmount({ status: "REJECTED", approvedAmount: null, requestedAmount: 40 })).toBe(40);
  });

  it("never clamps the sign of a deduction", () => {
    expect(adjustmentDisplayAmount({ status: "APPROVED", approvedAmount: -30, requestedAmount: -30 })).toBe(-30);
    expect(adjustmentDisplayAmount({ status: "PENDING", approvedAmount: null, requestedAmount: -30 })).toBe(-30);
  });
});

describe("computeJobPaySummary", () => {
  it("returns base pay only when there are no adjustments", () => {
    const [row] = summary();
    expect(row.basePay.amount).toBe(100); // 2h × $50
    expect(row.basePay.basis).toBe("ALLOCATED");
    expect(row.approvedTotal).toBe(100);
    expect(row.pendingDelta).toBe(0);
    expect(row.adjustments).toEqual([]);
  });

  it("adds an approved addition and subtracts an approved deduction", () => {
    const [add] = summary({ adjustments: [adj({ approvedAmount: 40, requestedAmount: 40 })] });
    expect(add.approvedTotal).toBe(140);

    const [ded] = summary({ adjustments: [adj({ approvedAmount: -30, requestedAmount: -30 })] });
    expect(ded.approvedTotal).toBe(70);
    expect(ded.adjustments[0].amount).toBe(-30);
  });

  it("keeps PENDING money out of approvedTotal and reports it as pendingDelta", () => {
    const [row] = summary({
      adjustments: [
        adj({ id: "ok", approvedAmount: 20, requestedAmount: 20 }),
        adj({ id: "p1", status: "PENDING", approvedAmount: null, requestedAmount: 55 }),
        adj({ id: "p2", status: "PENDING", approvedAmount: null, requestedAmount: -15 }),
        adj({ id: "rej", status: "REJECTED", approvedAmount: null, requestedAmount: 99 }),
      ],
    });
    expect(row.approvedTotal).toBe(120); // 100 base + 20 approved
    expect(row.pendingDelta).toBe(40); // 55 - 15
    expect(row.adjustments).toHaveLength(4);
  });

  it("shows a settled adjustment but marks it not editable", () => {
    const [row] = summary({
      adjustments: [adj({ includedInCleanerInvoiceId: "inv9", includedInCleanerInvoiceAt: new Date("2026-07-05T00:00:00Z") })],
    });
    expect(row.adjustments[0].editable).toBe(false);
    expect(row.adjustments[0].settled).toEqual({
      rail: "INVOICE",
      id: "inv9",
      at: "2026-07-05T00:00:00.000Z",
    });
    // Still counted — it is approved money this job pays.
    expect(row.approvedTotal).toBe(140);
  });

  it("splits allocated hours across active cleaners and ignores removed ones", () => {
    const rows = computeJobPaySummary({ audience: "internal",
      job: JOB,
      assignments: [
        { userId: "u1", payRate: 50, removedAt: null, userName: "One" },
        { userId: "u2", payRate: 50, removedAt: null, userName: "Two" },
        { userId: "u3", payRate: 50, removedAt: new Date(), userName: "Gone" },
      ],
      settings: {},
      adjustments: [],
    } as any);
    expect(rows).toHaveLength(2);
    expect(rows[0].basePay.amount).toBe(50); // (2h ÷ 2) × $50
    expect(rows[0].basePay.split).toBe(2);
    expect(rows.map((r) => r.cleanerId)).not.toContain("u3");
  });

  it("honours the rework rule — pay is the QA decision, not hours × rate", () => {
    const [unpaid] = summary({ job: { ...JOB, isRework: true, reworkPayAmount: null } });
    expect(unpaid.approvedTotal).toBe(0);

    const [paid] = summary({ job: { ...JOB, isRework: true, reworkPayAmount: 45 } });
    expect(paid.approvedTotal).toBe(45);
    expect(paid.basePay.source).toBe("CUSTOM");
  });

  it("GROUPS BY PAYEE: a QA credit on a cleaner's job belongs to the QA user", () => {
    const rows = computeJobPaySummary({ audience: "internal",
      job: JOB,
      assignments: [
        { userId: "cleaner1", payRate: 50, removedAt: null, userName: "Cleaner One", userRole: "CLEANER" },
      ],
      settings: {},
      adjustments: [
        // The cleaner is DEDUCTED for the failed clean...
        adj({
          id: "ded",
          cleanerId: "cleaner1",
          approvedAmount: -30,
          requestedAmount: -30,
          source: "RECTIFICATION_DEDUCTION",
          sourceKey: "rect:issue1:ded",
        }),
        // ...and the QA inspector is CREDITED on the SAME job row.
        adj({
          id: "credit",
          cleanerId: "qa1",
          cleanerName: "Inspector Ivy",
          cleanerRole: "QA_INSPECTOR",
          approvedAmount: 30,
          requestedAmount: 30,
          source: "QA_RECTIFICATION_PAY",
          sourceKey: "rect:issue1",
        }),
      ],
    } as any);

    expect(rows).toHaveLength(2);

    const cleaner = rows.find((r) => r.cleanerId === "cleaner1")!;
    expect(cleaner.assigned).toBe(true);
    expect(cleaner.adjustments.map((a) => a.id)).toEqual(["ded"]);
    expect(cleaner.approvedTotal).toBe(70); // 100 base − 30 deduction

    const qa = rows.find((r) => r.cleanerId === "qa1")!;
    expect(qa.assigned).toBe(false);
    expect(qa.cleanerName).toBe("Inspector Ivy");
    expect(qa.cleanerRole).toBe("QA_INSPECTOR");
    expect(qa.basePay.amount).toBe(0);
    expect(qa.basePay.basis).toBe("NONE");
    // The credit is the QA's money — it must NOT be inside the cleaner's total.
    expect(qa.approvedTotal).toBe(30);
    expect(qa.adjustments.map((a) => a.id)).toEqual(["credit"]);
    expect(qa.adjustments[0].origin).toBe("AUTOMATIC");
  });
});

describe("describeAdjustment", () => {
  it("carries what-changed, who decided and when into the display shape", () => {
    const item = describeAdjustment(
      adj({
        title: "Rework deduction",
        cleanerNote: "Bathroom missed",
        adminNote: "Confirmed by QA",
        source: "REWORK_DEDUCTION",
        sourceKey: "rework:job1",
        approvedAmount: -25,
        requestedAmount: -25,
        reviewedByName: "Ops Olly",
      }),
      "internal"
    );
    expect(item.amount).toBe(-25);
    expect(item.origin).toBe("AUTOMATIC");
    expect(item.originLabel).toBe("Automatic — rework deduction");
    expect(item.reason).toBe("Bathroom missed · Admin: Confirmed by QA");
    expect(item.decidedBy).toBe("Ops Olly");
    expect(item.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(item.decidedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(item.editable).toBe(true);
  });

  /**
   * The audience matrix. `adminNote` is the reviewing admin's private note
   * about the decision; it was being appended to the reason on the cleaner's
   * own job screen as "Admin: …".
   */
  it("withholds the admin's private note from the payee", () => {
    const row = adj({
      cleanerNote: "Bathroom missed",
      adminNote: "Third time this month — watch this one",
      approvedAmount: -25,
      requestedAmount: -25,
      reviewedByName: "Ops Olly",
    });

    expect(describeAdjustment(row, "self").reason).toBe("Bathroom missed");
    expect(describeAdjustment(row, "internal").reason).toBe(
      "Bathroom missed · Admin: Third time this month — watch this one"
    );
  });

  it("never lets the admin note reach the payee through any field", () => {
    const secret = "PRIVATE-ADMIN-NOTE";
    const item = describeAdjustment(
      adj({ cleanerNote: "Parking", adminNote: secret, approvedAmount: 12, requestedAmount: 12 }),
      "self"
    );
    expect(JSON.stringify(item)).not.toContain(secret);
  });

  it("keeps the cleaner's own note when there is no admin note", () => {
    expect(
      describeAdjustment(adj({ cleanerNote: "Parking receipt attached" }), "self").reason
    ).toBe("Parking receipt attached");
  });

  it("reports no reason at all rather than an empty admin prefix", () => {
    // Admin-note-only row seen by the payee: the reason must be null, not
    // "Admin: " or an empty string.
    expect(
      describeAdjustment(adj({ cleanerNote: null, adminNote: "internal only" }), "self").reason
    ).toBeNull();
  });
});
