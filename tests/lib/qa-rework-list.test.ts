import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import {
  officeAlsoInspects,
  resolveReworkScope,
  reworkMineWhere,
  reworkProgress,
  reworkScopeWhere,
} from "@/lib/qa/rework-list";

/** Owner decision 2026-11-12: who sees which rework, enforced in the query. */
describe("rework list scope", () => {
  const inspector = { id: "qa-1", role: Role.QA_INSPECTOR, heldRoles: [Role.QA_INSPECTOR] };
  const admin = { id: "ad-1", role: Role.ADMIN, heldRoles: [Role.ADMIN] };
  const adminInspector = { id: "ad-2", role: Role.ADMIN, heldRoles: [Role.ADMIN, Role.QA_INSPECTOR] };
  const ops = { id: "ops-1", role: Role.OPS_MANAGER, heldRoles: [Role.OPS_MANAGER] };

  it("an inspector is always scoped to their own, whatever the URL asks", () => {
    expect(resolveReworkScope(inspector, "all")).toBe("mine");
    expect(resolveReworkScope(inspector, null)).toBe("mine");
    expect(reworkScopeWhere(inspector, "all")).toEqual(reworkMineWhere("qa-1"));
  });

  it("the office sees all by default and may narrow to Mine", () => {
    expect(resolveReworkScope(admin, null)).toBe("all");
    expect(resolveReworkScope(ops, "mine")).toBe("mine");
    expect(reworkScopeWhere(admin, "all")).toEqual({});
    expect(reworkScopeWhere(ops, "mine")).toEqual(reworkMineWhere("ops-1"));
  });

  it("offers the Mine / All choice only to office members who also inspect", () => {
    expect(officeAlsoInspects(inspector)).toBe(false);
    expect(officeAlsoInspects(admin)).toBe(false);
    expect(officeAlsoInspects(adminInspector)).toBe(true);
    expect(officeAlsoInspects(ops)).toBe(true);
  });

  it("'mine' covers raised by me, my inspection (assigned or picked up) and rework jobs handed to me", () => {
    const where = reworkMineWhere("qa-1");
    expect(where.OR).toEqual([
      { qaUserId: "qa-1" },
      { assignment: { is: { assignedToId: "qa-1" } } },
      { assignment: { is: { pickedUpById: "qa-1" } } },
      { job: { reworkChildren: { some: { isRework: true, assignments: { some: { userId: "qa-1", removedAt: null } } } } } },
    ]);
  });
});

describe("offer-back progress", () => {
  const now = new Date("2026-11-13T00:00:00Z");

  it("reads the rework clean first: waiting, in progress, done", () => {
    expect(reworkProgress({ offerStatus: null, reworkJobs: [{ status: "ASSIGNED" }], now })?.label).toBe("Waiting");
    expect(reworkProgress({ offerStatus: null, reworkJobs: [{ status: "IN_PROGRESS" }], now })?.label).toBe("In progress");
    expect(reworkProgress({ offerStatus: null, reworkJobs: [{ status: "COMPLETED" }], now })?.key).toBe("DONE");
  });

  it("falls back to the offer to the cleaner", () => {
    expect(reworkProgress({ offerStatus: "OFFERED", offerExpiresAt: "2026-11-13T01:00:00Z", reworkJobs: [], now })?.label).toBe("Waiting");
    expect(reworkProgress({ offerStatus: "OFFERED", offerExpiresAt: "2026-11-12T23:00:00Z", reworkJobs: [], now })?.key).toBe("OFFER_EXPIRED");
    expect(reworkProgress({ offerStatus: "ACCEPTED", reworkJobs: [], now })?.label).toBe("In progress");
    expect(reworkProgress({ offerStatus: "DECLINED", reworkJobs: [], now })?.key).toBe("OFFER_DECLINED");
  });

  it("shows nothing when there is no offer and no rework clean (never a guessed state)", () => {
    expect(reworkProgress({ offerStatus: null, reworkJobs: [], now })).toBeNull();
    expect(reworkProgress({ offerStatus: "NONE", reworkJobs: [{ status: "CANCELLED" }], now })).toBeNull();
  });
});
