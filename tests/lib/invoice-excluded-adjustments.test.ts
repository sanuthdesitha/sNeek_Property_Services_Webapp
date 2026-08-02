import { describe, expect, it } from "vitest";
import { partitionAdjustmentsForInvoice } from "@/lib/finance/pay-adjustments";

/**
 * The invoice drops removed adjustments BEFORE partitioning them, which is the
 * only placement that keeps three things in agreement: the carry-over lines,
 * the per-job totals folded into job lines, and the set of rows the invoice
 * stamps as settled. These tests pin that behaviour, because filtering after
 * the partition would leave an excluded job-linked row's money inside its
 * job's line while the payee believed they had taken it off.
 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "adj-1",
    jobId: null as string | null,
    status: "APPROVED",
    type: "FIXED",
    requestedAmount: 50,
    approvedAmount: 50,
    includedInPayrollRunId: null as string | null,
    includedInCleanerInvoiceId: null as string | null,
    ...overrides,
  } as any;
}

const OPTIONS = { jobIdsOnInvoice: ["job-a"], includeInvoiceId: null, includePayrollRunId: null };

function withExclusions(rows: any[], excluded: string[]) {
  const set = new Set(excluded);
  return partitionAdjustmentsForInvoice(
    rows.filter((r) => !set.has(r.id)),
    OPTIONS
  );
}

describe("excluding adjustments from an invoice", () => {
  it("removes an excluded job-linked row from that job's total", () => {
    const rows = [
      row({ id: "keep", jobId: "job-a", approvedAmount: 30 }),
      row({ id: "drop", jobId: "job-a", approvedAmount: 70 }),
    ];

    expect(withExclusions(rows, []).perJobTotals.get("job-a")).toBe(100);
    // Not 100: the excluded row's money must leave the job line too.
    expect(withExclusions(rows, ["drop"]).perJobTotals.get("job-a")).toBe(30);
  });

  it("removes an excluded unlinked row from the carry-over lines", () => {
    const rows = [row({ id: "keep" }), row({ id: "drop" })];

    expect(withExclusions(rows, ["drop"]).carryOverRows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("never stamps an excluded row as settled, so it stays owed", () => {
    const rows = [row({ id: "keep", jobId: "job-a" }), row({ id: "drop" })];

    const included = withExclusions(rows, ["drop"]).includedRows.map((r) => r.id);
    expect(included).toContain("keep");
    expect(included).not.toContain("drop");
  });

  it("leaves everything untouched when nothing is excluded", () => {
    const rows = [row({ id: "a", jobId: "job-a" }), row({ id: "b" })];
    const split = withExclusions(rows, []);

    expect(split.includedRows).toHaveLength(2);
    expect(split.perJobTotals.get("job-a")).toBe(50);
    expect(split.carryOverRows.map((r) => r.id)).toEqual(["b"]);
  });

  it("keeps a deduction's negative sign when it survives the filter", () => {
    // A rework deduction is stored negative; excluding a sibling row must not
    // change how the remaining one is signed.
    const rows = [
      row({ id: "credit", jobId: "job-a", approvedAmount: 40 }),
      row({ id: "debit", jobId: "job-a", approvedAmount: -25 }),
    ];

    expect(withExclusions(rows, ["credit"]).perJobTotals.get("job-a")).toBe(-25);
  });
});
