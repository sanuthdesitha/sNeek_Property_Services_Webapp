import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NOBODY INSPECTS THEIR OWN WORK — the guard on the write path.
 *
 * `mayAssignQa` was unit-tested from the day it was written and NOTHING CALLED
 * IT, so the rule was true in the test suite and absent everywhere a save could
 * reach. These tests cover the wiring rather than the rule: that
 * `setItemAssignees` actually asks, in both directions, and refuses loudly.
 *
 * The both-directions case is the one that matters. A QA-only check is defeated
 * by the order of the saves — assign someone QA first, then add them as a
 * cleaner, and a one-way guard waves the pair straight through.
 */

const state = {
  item: { id: "item-1", jobId: null as string | null },
  /** Active assignments already on the item. */
  existing: [] as Array<{ userId: string; role: string }>,
  /** Cleaners on the job the item came from. */
  jobCleaners: [] as string[],
};

vi.mock("@/lib/db", () => ({
  db: {
    propertyMaintenanceItem: {
      findUnique: vi.fn(async ({ select }: any) =>
        select?.jobId ? { jobId: state.item.jobId } : { id: state.item.id }
      ),
    },
    maintenanceItemAssignment: {
      findMany: vi.fn(async ({ where }: any) =>
        state.existing
          .filter((row) => (where.role ? row.role === where.role : true))
          .map((row) => ({ userId: row.userId }))
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    jobAssignment: {
      findMany: vi.fn(async () => state.jobCleaners.map((userId) => ({ userId }))),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) =>
        (where.id?.in ?? []).map((id: string) => ({
          id,
          name: `Person ${id}`,
          email: `${id}@example.test`,
          // The eligibility query asks for active users of the matching role;
          // echoing back every requested id keeps these tests about the guard
          // rather than about role eligibility, which has its own coverage.
          role: where.role,
          isActive: true,
        }))
      ),
    },
    $transaction: vi.fn(async (fn: any) =>
      fn({
        maintenanceItemAssignment: {
          updateMany: vi.fn(async () => ({ count: 0 })),
          upsert: vi.fn(async () => ({})),
        },
      })
    ),
  },
}));

import { MaintenanceAssigneeRole } from "@prisma/client";
import { setItemAssignees } from "@/lib/maintenance/assignments";

beforeEach(() => {
  state.item = { id: "item-1", jobId: null };
  state.existing = [];
  state.jobCleaners = [];
});

describe("setItemAssignees — self-review failsafe", () => {
  it("refuses to make a cleaner on the item its QA inspector", async () => {
    state.existing = [{ userId: "u1", role: MaintenanceAssigneeRole.CLEANER }];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.QA,
        userIds: ["u1"],
      })
    ).rejects.toThrow(/cannot inspect it/i);
  });

  it("refuses the reverse too, so the order of the saves cannot defeat it", async () => {
    state.existing = [{ userId: "u1", role: MaintenanceAssigneeRole.QA }];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.CLEANER,
        userIds: ["u1"],
      })
    ).rejects.toThrow(/cannot also do the cleaning/i);
  });

  it("counts the cleaners on the job the item came from, not just the item", async () => {
    state.item.jobId = "job-9";
    state.jobCleaners = ["u7"];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.QA,
        userIds: ["u7"],
      })
    ).rejects.toThrow(/cannot inspect it/i);
  });

  it("names the person it blocked, so an admin is not left guessing", async () => {
    state.existing = [{ userId: "u1", role: MaintenanceAssigneeRole.CLEANER }];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.QA,
        userIds: ["u1"],
      })
    ).rejects.toThrow(/Person u1/);
  });

  it("blocks the whole save, not just the offending name", async () => {
    // Partially applying would leave the admin looking at a roster that is not
    // the one they pressed save on, and no message explaining the difference.
    state.existing = [{ userId: "u1", role: MaintenanceAssigneeRole.CLEANER }];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.QA,
        userIds: ["u2", "u1", "u3"],
      })
    ).rejects.toThrow();
  });

  it("allows a QA inspector who had nothing to do with the clean", async () => {
    state.existing = [{ userId: "u1", role: MaintenanceAssigneeRole.CLEANER }];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.QA,
        userIds: ["u9"],
      })
    ).resolves.toBeTruthy();
  });

  it("never blocks the maintenance role — a trade doing the repair is not review", async () => {
    state.existing = [
      { userId: "u1", role: MaintenanceAssigneeRole.CLEANER },
      { userId: "u1", role: MaintenanceAssigneeRole.QA },
    ];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.MAINTENANCE,
        userIds: ["u1"],
      })
    ).resolves.toBeTruthy();
  });

  it("does nothing on an empty roster save, rather than querying for conflicts", async () => {
    state.existing = [{ userId: "u1", role: MaintenanceAssigneeRole.CLEANER }];

    await expect(
      setItemAssignees({
        itemId: "item-1",
        role: MaintenanceAssigneeRole.QA,
        userIds: [],
      })
    ).resolves.toBeTruthy();
  });
});
