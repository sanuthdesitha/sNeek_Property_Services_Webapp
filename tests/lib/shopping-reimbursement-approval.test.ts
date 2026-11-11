// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/s3", () => ({ resolveS3: vi.fn(), publicUrl: () => "" }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { nextCleanerReimbursementStatus, shoppingRunPayerId } from "@/lib/inventory/shopping-runs";
import { shoppingExpenseCountsTowardPay } from "@/lib/finance/shopping-settlement";

const claim = (overrides = {}) => ({ previous: undefined, reimbursable: true, cleanerOwned: true, costChanged: true, ...overrides }) as any;

describe("a cleaner's shopping claim waits for the office", () => {
  it("is pending, not payable, when a cleaner saves a cost", () => {
    expect(nextCleanerReimbursementStatus(claim())).toBe("PENDING_APPROVAL");
    expect(shoppingExpenseCountsTowardPay("PENDING_APPROVAL")).toBe(false);
  });

  it("is payable once approved, and stays approved while the amount is unchanged", () => {
    expect(shoppingExpenseCountsTowardPay("READY")).toBe(true);
    expect(nextCleanerReimbursementStatus(claim({ previous: "READY", costChanged: false }))).toBe("READY");
  });

  it("goes back for approval if the cleaner changes the amount afterwards", () => {
    expect(nextCleanerReimbursementStatus(claim({ previous: "READY", costChanged: true }))).toBe("PENDING_APPROVAL");
  });

  it("never moves a claim that is already invoiced or reimbursed", () => {
    expect(nextCleanerReimbursementStatus(claim({ previous: "INVOICED" }))).toBe("INVOICED");
    expect(nextCleanerReimbursementStatus(claim({ previous: "REIMBURSED", reimbursable: false }))).toBe("REIMBURSED");
  });

  it("is not applicable when nothing was paid out of pocket", () => {
    expect(nextCleanerReimbursementStatus(claim({ reimbursable: false, previous: "PENDING_APPROVAL" }))).toBe("NOT_APPLICABLE");
    expect(shoppingExpenseCountsTowardPay("NOT_APPLICABLE")).toBe(false);
  });

  it("leaves office and client runs on their existing rule", () => {
    expect(nextCleanerReimbursementStatus(claim({ cleanerOwned: false }))).toBe("READY");
  });
});

describe("who paid for a cleaner run", () => {
  it("is the recorded payer, or the owner when none was recorded", () => {
    expect(shoppingRunPayerId({ ownerUserId: "owner", payment: { paidByUserId: "payer" } })).toBe("payer");
    expect(shoppingRunPayerId({ ownerUserId: "owner", payment: { paidByUserId: null } })).toBe("owner");
    expect(shoppingRunPayerId({ ownerUserId: "owner", payment: { paidByUserId: "  " } })).toBe("owner");
  });
});
