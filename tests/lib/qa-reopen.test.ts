import { describe, it, expect } from "vitest";
import {
  REOPEN_REASON_MIN_LENGTH,
  canReopenInspection,
  reopenMoneyWarnings,
  reopenTouchesMoney,
  type ReopenEligibilityInput,
  type ReopenMoneyFacts,
} from "@/lib/qa/reopen";

const INSPECTOR = "user-inspector";
const OTHER = "user-other";

function input(over: Partial<ReopenEligibilityInput> = {}): ReopenEligibilityInput {
  return {
    actorUserId: INSPECTOR,
    actorRole: "QA_INSPECTOR",
    assignment: { status: "COMPLETED", assignedToId: INSPECTOR, pickedUpById: INSPECTOR },
    jobStatus: "COMPLETED",
    reason: "Graded the ensuite wrong, fixing the verdict.",
    ...over,
  };
}

const NO_MONEY: ReopenMoneyFacts = {
  reworkJobCount: 0,
  startedReworkJobCount: 0,
  payAdjustmentCount: 0,
  settledPayAdjustmentCount: 0,
  issuesWithPayAdjustmentCount: 0,
  actionedIssueCount: 0,
};

describe("canReopenInspection", () => {
  it("lets the assigned inspector reopen their own completed inspection", () => {
    expect(canReopenInspection(input())).toEqual({ ok: true });
  });

  it("lets the inspector who picked it up reopen it even if it was assigned to nobody", () => {
    expect(
      canReopenInspection(
        input({ assignment: { status: "COMPLETED", assignedToId: null, pickedUpById: INSPECTOR } })
      ).ok
    ).toBe(true);
  });

  it("lets an admin and an ops manager reopen someone else's inspection", () => {
    for (const role of ["ADMIN", "OPS_MANAGER"]) {
      expect(
        canReopenInspection(
          input({
            actorRole: role,
            actorUserId: "user-boss",
            assignment: { status: "COMPLETED", assignedToId: OTHER, pickedUpById: OTHER },
          })
        ).ok
      ).toBe(true);
    }
  });

  it("blocks another inspector's inspection", () => {
    const result = canReopenInspection(
      input({ assignment: { status: "COMPLETED", assignedToId: OTHER, pickedUpById: OTHER } })
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_YOUR_INSPECTION");
  });

  it("blocks roles that have no business in QA", () => {
    const result = canReopenInspection(input({ actorRole: "CLEANER" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ROLE_NOT_ALLOWED");
  });

  it("blocks an invoiced job even for an admin", () => {
    const result = canReopenInspection(input({ actorRole: "ADMIN", jobStatus: "INVOICED" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("JOB_LOCKED");
  });

  it("blocks an inspection that was never submitted", () => {
    for (const status of ["OPEN", "ASSIGNED", "IN_PROGRESS", "CANCELLED"]) {
      const result = canReopenInspection(
        input({ assignment: { status, assignedToId: INSPECTOR, pickedUpById: INSPECTOR } })
      );
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NOT_COMPLETED");
    }
  });

  it("requires a real reason", () => {
    const result = canReopenInspection(input({ reason: "oops" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("REASON_TOO_SHORT");
    expect(canReopenInspection(input({ reason: "   " })).code).toBe("REASON_TOO_SHORT");
    expect(canReopenInspection(input({ reason: "x".repeat(REOPEN_REASON_MIN_LENGTH) })).ok).toBe(true);
  });

  it("skips the reason check when the reason is omitted (button visibility)", () => {
    expect(canReopenInspection(input({ reason: undefined })).ok).toBe(true);
  });

  it("reports the job lock before the assignment state", () => {
    const result = canReopenInspection(
      input({
        actorRole: "ADMIN",
        jobStatus: "INVOICED",
        assignment: { status: "OPEN", assignedToId: null, pickedUpById: null },
      })
    );
    expect(result.code).toBe("JOB_LOCKED");
  });

  it("always explains itself in operator English", () => {
    const result = canReopenInspection(input({ actorRole: "CLEANER" }));
    expect(result.message).toBeTruthy();
    expect(result.message).not.toMatch(/[A-Z]{2,}_[A-Z]/); // no enum codes in the copy
  });
});

describe("reopenMoneyWarnings", () => {
  it("says nothing when the inspection moved no money", () => {
    expect(reopenMoneyWarnings(NO_MONEY)).toEqual([]);
    expect(reopenTouchesMoney(NO_MONEY)).toBe(false);
  });

  it("warns that a rework job is not cancelled by reopening", () => {
    const warnings = reopenMoneyWarnings({ ...NO_MONEY, reworkJobCount: 1, startedReworkJobCount: 1 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/rework job/);
    expect(warnings[0]).toMatch(/already started/);
    expect(warnings[0]).toMatch(/does not cancel/);
  });

  it("warns that pay is not reversed and points at the Approval Center", () => {
    const warnings = reopenMoneyWarnings({
      ...NO_MONEY,
      payAdjustmentCount: 2,
      settledPayAdjustmentCount: 1,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 pay adjustments/);
    expect(warnings[0]).toMatch(/Approval Center/);
  });

  it("warns that already-actioned findings survive the amendment", () => {
    const warnings = reopenMoneyWarnings({
      ...NO_MONEY,
      issuesWithPayAdjustmentCount: 1,
      actionedIssueCount: 2,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/3 flagged items/);
  });

  it("stacks every applicable warning", () => {
    const facts: ReopenMoneyFacts = {
      reworkJobCount: 1,
      startedReworkJobCount: 0,
      payAdjustmentCount: 1,
      settledPayAdjustmentCount: 0,
      issuesWithPayAdjustmentCount: 1,
      actionedIssueCount: 0,
    };
    expect(reopenMoneyWarnings(facts)).toHaveLength(3);
    expect(reopenTouchesMoney(facts)).toBe(true);
  });
});
