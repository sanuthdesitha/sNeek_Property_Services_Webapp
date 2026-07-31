import { describe, expect, it } from "vitest";
import {
  isQaAssignmentOwner,
  qaAssignmentClaimableWhere,
  qaAssignmentHasPayeeWhere,
  qaAssignmentOwnerWhere,
  qaAssignmentPayeeId,
  qaAssignmentPayeeWhere,
} from "@/lib/qa/ownership";

/**
 * These guard the defect that made every self-picked-up inspection unpayable:
 * `/pickup`, the on-site timer and the submit path stamp `pickedUpById` and
 * leave `assignedToId` null, while the pay page, payroll and the cleaner
 * invoice rail all keyed on `assignedToId` alone.
 */

const ME = "user_me";
const OTHER = "user_other";

/** Mirrors Prisma's matching for the small subset of operators used here. */
function matchesWhere(where: any, row: Record<string, unknown>): boolean {
  if (where.OR) return where.OR.some((clause: any) => matchesWhere(clause, row));
  if (where.AND) return where.AND.every((clause: any) => matchesWhere(clause, row));
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null;
    if (expected && typeof expected === "object" && "not" in (expected as any)) {
      return actual !== (expected as any).not;
    }
    return actual === expected;
  });
}

const ASSIGNED_TO_ME = { assignedToId: ME, pickedUpById: null };
const PICKED_UP_BY_ME = { assignedToId: null, pickedUpById: ME };
const ASSIGNED_TO_ME_DONE_BY_OTHER = { assignedToId: ME, pickedUpById: OTHER };
const NEITHER = { assignedToId: null, pickedUpById: null };
const SOMEONE_ELSES = { assignedToId: OTHER, pickedUpById: OTHER };

describe("qaAssignmentPayeeId", () => {
  it("pays whoever performed the inspection", () => {
    expect(qaAssignmentPayeeId(PICKED_UP_BY_ME)).toBe(ME);
  });

  it("falls back to the assignee when nobody picked it up", () => {
    expect(qaAssignmentPayeeId(ASSIGNED_TO_ME)).toBe(ME);
  });

  it("prefers the performer over the assignee when they differ", () => {
    // An admin assigned it to ME but OTHER actually did it — OTHER is paid.
    // Paying the assignee here would pay someone who never inspected anything.
    expect(qaAssignmentPayeeId(ASSIGNED_TO_ME_DONE_BY_OTHER)).toBe(OTHER);
  });

  it("returns null when the row has no people at all", () => {
    expect(qaAssignmentPayeeId(NEITHER)).toBeNull();
  });
});

describe("qaAssignmentPayeeWhere", () => {
  const where = qaAssignmentPayeeWhere(ME);

  it("selects a self-picked-up inspection (the regression)", () => {
    expect(matchesWhere(where, PICKED_UP_BY_ME)).toBe(true);
  });

  it("selects an assigned-but-never-picked-up inspection", () => {
    expect(matchesWhere(where, ASSIGNED_TO_ME)).toBe(true);
  });

  it("does NOT select an inspection assigned to me but performed by someone else", () => {
    // Otherwise the same inspection is payable to two people on two rails.
    expect(matchesWhere(where, ASSIGNED_TO_ME_DONE_BY_OTHER)).toBe(false);
  });

  it("does not select other people's work", () => {
    expect(matchesWhere(where, SOMEONE_ELSES)).toBe(false);
    expect(matchesWhere(where, NEITHER)).toBe(false);
  });

  it("agrees with qaAssignmentPayeeId on every shape", () => {
    // The query and the attribution must never disagree, or payroll selects
    // money it then fails to attribute to anyone.
    for (const row of [
      ASSIGNED_TO_ME,
      PICKED_UP_BY_ME,
      ASSIGNED_TO_ME_DONE_BY_OTHER,
      NEITHER,
      SOMEONE_ELSES,
    ]) {
      expect(matchesWhere(where, row)).toBe(qaAssignmentPayeeId(row) === ME);
    }
  });
});

describe("qaAssignmentHasPayeeWhere", () => {
  const where = qaAssignmentHasPayeeWhere();

  it("accepts any row payroll can attribute", () => {
    expect(matchesWhere(where, ASSIGNED_TO_ME)).toBe(true);
    expect(matchesWhere(where, PICKED_UP_BY_ME)).toBe(true);
    expect(matchesWhere(where, SOMEONE_ELSES)).toBe(true);
  });

  it("rejects a row with nobody to pay", () => {
    expect(matchesWhere(where, NEITHER)).toBe(false);
  });
});

describe("qaAssignmentOwnerWhere / isQaAssignmentOwner", () => {
  const where = qaAssignmentOwnerWhere(ME);

  it("covers both columns for visibility", () => {
    expect(matchesWhere(where, ASSIGNED_TO_ME)).toBe(true);
    expect(matchesWhere(where, PICKED_UP_BY_ME)).toBe(true);
    // Assigned to me, performed by someone else: I may still see it.
    expect(matchesWhere(where, ASSIGNED_TO_ME_DONE_BY_OTHER)).toBe(true);
  });

  it("excludes other people's and unclaimed work", () => {
    expect(matchesWhere(where, SOMEONE_ELSES)).toBe(false);
    expect(matchesWhere(where, NEITHER)).toBe(false);
  });

  it("is broader than the payee rule — visibility is not payment", () => {
    expect(matchesWhere(where, ASSIGNED_TO_ME_DONE_BY_OTHER)).toBe(true);
    expect(matchesWhere(qaAssignmentPayeeWhere(ME), ASSIGNED_TO_ME_DONE_BY_OTHER)).toBe(false);
  });

  it("matches the in-memory predicate", () => {
    expect(isQaAssignmentOwner(PICKED_UP_BY_ME, ME)).toBe(true);
    expect(isQaAssignmentOwner(SOMEONE_ELSES, ME)).toBe(false);
  });
});

describe("qaAssignmentClaimableWhere", () => {
  const where = qaAssignmentClaimableWhere(ME);

  it("adds unclaimed work to the owner set", () => {
    expect(matchesWhere(where, NEITHER)).toBe(true);
    expect(matchesWhere(where, ASSIGNED_TO_ME)).toBe(true);
    expect(matchesWhere(where, PICKED_UP_BY_ME)).toBe(true);
  });

  it("still excludes work owned by someone else", () => {
    expect(matchesWhere(where, SOMEONE_ELSES)).toBe(false);
  });
});
