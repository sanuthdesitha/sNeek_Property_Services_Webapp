// @vitest-environment node
/**
 * Owner decisions 2026-11-12 on a real, disposable PostgreSQL (127.0.0.1:55439):
 *  - visit order: an inspector reorders their own day; an office order locks
 *    it ("Order set by the office"); the office clears the lock; stale writes,
 *    other inspectors' visits and other days are refused; the inspector's
 *    order never overrides an office lock;
 *  - rework list scope: an inspector's query returns only rework from their
 *    own inspections or handed to them, the office sees all;
 *  - QA Fail storage: the CHECK constraints keep Fail in the severity grouping.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, QaAssignmentStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));

import {
  clearOfficeDayLock,
  getDayOrderState,
  OFFICE_LOCK_REASON,
  reorderOwnDay,
  setOfficeDayOrder,
} from "@/lib/qa/day-order";
import { reworkScopeWhere } from "@/lib/qa/rework-list";
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `qamd-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const day = sydneyTodayKey();
const tomorrow = addDaysToKey(day, 1);

async function sequenceOf(ids: string[]): Promise<string[]> {
  const rows = await m.client.qaAssignment.findMany({ where: { id: { in: ids } }, orderBy: { sequence: "asc" }, select: { id: true } });
  return rows.map((row) => row.id);
}

describe.skipIf(!url)("QA and maintenance owner decisions (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") {
      throw Error("Dedicated loopback fixture database required");
    }
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({
      data: [
        { id: id("qa"), email: `${id("qa")}@test.local`, role: "QA_INSPECTOR", name: "Ins Pector" },
        { id: id("qa2"), email: `${id("qa2")}@test.local`, role: "QA_INSPECTOR", name: "Other Inspector" },
        { id: id("ops"), email: `${id("ops")}@test.local`, role: "OPS_MANAGER", name: "Mia Office" },
        { id: id("cl"), email: `${id("cl")}@test.local`, role: "CLEANER", name: "Cleaner" },
      ],
    });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} client` } });
    await m.client.property.create({ data: { id: id("prop"), clientId: id("client"), name: `${tag} prop`, address: "1 St", suburb: "Bondi" } });
    const midday = new Date(sydneyDayStart(day).getTime() + 12 * 3_600_000);
    const nextMidday = new Date(sydneyDayStart(tomorrow).getTime() + 12 * 3_600_000);
    const jobs = ["a", "b", "c", "other", "later", "r1", "r2"];
    await m.client.job.createMany({
      data: jobs.map((name) => ({
        id: id(`job-${name}`),
        jobNumber: id(`J-${name}`),
        propertyId: id("prop"),
        jobType: "AIRBNB_TURNOVER" as const,
        scheduledDate: name === "later" ? nextMidday : midday,
      })),
    });
    await m.client.qaAssignment.createMany({
      data: [
        { id: id("as-a"), jobId: id("job-a"), assignedToId: id("qa"), status: QaAssignmentStatus.ASSIGNED, sequence: 1 },
        { id: id("as-b"), jobId: id("job-b"), assignedToId: id("qa"), status: QaAssignmentStatus.ASSIGNED, sequence: 2 },
        { id: id("as-c"), jobId: id("job-c"), assignedToId: id("qa"), status: QaAssignmentStatus.IN_PROGRESS, sequence: 3 },
        { id: id("as-other"), jobId: id("job-other"), assignedToId: id("qa2"), status: QaAssignmentStatus.ASSIGNED, sequence: 1 },
        { id: id("as-later"), jobId: id("job-later"), assignedToId: id("qa"), status: QaAssignmentStatus.ASSIGNED, sequence: 1 },
        { id: id("as-r1"), jobId: id("job-r1"), assignedToId: id("qa"), status: QaAssignmentStatus.COMPLETED },
        { id: id("as-r2"), jobId: id("job-r2"), assignedToId: id("qa2"), status: QaAssignmentStatus.COMPLETED },
      ],
    });
    await m.client.qaReworkTransfer.createMany({
      data: [
        { id: id("rw-mine"), jobId: id("job-r1"), assignmentId: id("as-r1"), qaUserId: id("qa"), cleanerUserId: id("cl"), reason: "mine" },
        { id: id("rw-theirs"), jobId: id("job-r2"), assignmentId: id("as-r2"), qaUserId: id("qa2"), cleanerUserId: id("cl"), reason: "theirs" },
      ],
    });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.qaIssue.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.qaReworkTransfer.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.qaDayOrder.deleteMany({ where: { inspectorId: { startsWith: tag } } });
    await m.client.auditLog.deleteMany({ where: { userId: { startsWith: tag } } });
    await m.client.qaAssignment.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.job.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.property.deleteMany({ where: { id: id("prop") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.$disconnect();
  });

  const mine = () => [id("as-a"), id("as-b"), id("as-c")];

  it("lets the inspector reorder their own day and records it as theirs (no lock)", async () => {
    const result = await reorderOwnDay({
      inspectorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: [id("as-b"), id("as-a"), id("as-c")],
      expectedOrder: mine(),
    });
    expect(result.kind).toBe("saved");
    expect(await sequenceOf(mine())).toEqual([id("as-b"), id("as-a"), id("as-c")]);
    const state = await getDayOrderState(id("qa"), day);
    expect(state).toMatchObject({ locked: false, setByOffice: false, setByName: "Ins Pector" });
    const audit = await m.client.auditLog.findFirst({ where: { userId: id("qa"), action: "QA_VISIT_ORDER_SELF_REORDER" } });
    expect(audit).not.toBeNull();
  });

  it("refuses a stale order, another inspector's visit and another day's visit", async () => {
    const stale = await reorderOwnDay({
      inspectorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: [id("as-a"), id("as-b"), id("as-c")],
      expectedOrder: mine(), // the stored order is now b, a, c
    });
    expect(stale.kind).toBe("stale");
    const foreign = await reorderOwnDay({
      inspectorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: [id("as-other"), id("as-b"), id("as-a"), id("as-c")],
      expectedOrder: [id("as-b"), id("as-a"), id("as-c")],
    });
    expect(foreign.kind).toBe("invalid");
    const otherDay = await reorderOwnDay({
      inspectorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: [id("as-later"), id("as-b"), id("as-a"), id("as-c")],
      expectedOrder: [id("as-b"), id("as-a"), id("as-c")],
    });
    expect(otherDay.kind).toBe("invalid");
    expect(await sequenceOf(mine())).toEqual([id("as-b"), id("as-a"), id("as-c")]);
    expect((await m.client.qaAssignment.findUnique({ where: { id: id("as-other") } }))?.sequence).toBe(1);
  });

  it("an office order locks the day; the inspector is refused with the reason", async () => {
    const office = await setOfficeDayOrder({
      inspectorId: id("qa"),
      actorId: id("ops"),
      dayKey: day,
      orderedAssignmentIds: [id("as-c"), id("as-b"), id("as-a")],
    });
    expect(office.kind).toBe("saved");
    const state = await getDayOrderState(id("qa"), day);
    expect(state).toMatchObject({ locked: true, setByOffice: true, setByName: "Mia Office" });

    const refused = await reorderOwnDay({
      inspectorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: [id("as-a"), id("as-b"), id("as-c")],
      expectedOrder: [id("as-c"), id("as-b"), id("as-a")],
    });
    expect(refused.kind).toBe("locked");
    expect(OFFICE_LOCK_REASON).toBe("Order set by the office");
    // The office order stands.
    expect(await sequenceOf(mine())).toEqual([id("as-c"), id("as-b"), id("as-a")]);
    // Another day is not locked by it.
    expect((await getDayOrderState(id("qa"), tomorrow)).locked).toBe(false);
  });

  it("the office cannot place a lock with someone else's visits", async () => {
    const result = await setOfficeDayOrder({
      inspectorId: id("qa"),
      actorId: id("ops"),
      dayKey: day,
      orderedAssignmentIds: [id("as-other")],
    });
    expect(result.kind).toBe("invalid");
  });

  it("'Let inspector reorder' clears the lock, keeps the order, and the inspector may then reorder", async () => {
    const cleared = await clearOfficeDayLock({ inspectorId: id("qa"), actorId: id("ops"), dayKey: day });
    expect(cleared).toMatchObject({ locked: false, setByOffice: true, unlockedByName: "Mia Office" });
    expect(await sequenceOf(mine())).toEqual([id("as-c"), id("as-b"), id("as-a")]);
    const again = await reorderOwnDay({
      inspectorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: [id("as-a"), id("as-b"), id("as-c")],
      expectedOrder: [id("as-c"), id("as-b"), id("as-a")],
    });
    expect(again.kind).toBe("saved");
    expect((await getDayOrderState(id("qa"), day)).locked).toBe(false);
    const audit = await m.client.auditLog.findFirst({ where: { userId: id("ops"), action: "QA_VISIT_ORDER_UNLOCK" } });
    expect(audit).not.toBeNull();
  });

  it("an office member ordering their own day does not lock it", async () => {
    const result = await setOfficeDayOrder({
      inspectorId: id("qa"),
      actorId: id("qa"),
      dayKey: day,
      orderedAssignmentIds: mine(),
    });
    expect(result.kind === "saved" && result.state.locked).toBe(false);
  });

  it("scopes the rework query: the inspector gets only their own, the office all", async () => {
    const inspectorRows = await m.client.qaReworkTransfer.findMany({
      where: { AND: [{ id: { startsWith: tag } }, reworkScopeWhere({ id: id("qa"), role: "QA_INSPECTOR" }, "mine")] },
      select: { id: true },
    });
    expect(inspectorRows.map((row) => row.id)).toEqual([id("rw-mine")]);
    const officeRows = await m.client.qaReworkTransfer.findMany({
      where: { AND: [{ id: { startsWith: tag } }, reworkScopeWhere({ id: id("ops"), role: "OPS_MANAGER" }, "all")] },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(officeRows.map((row) => row.id).sort()).toEqual([id("rw-mine"), id("rw-theirs")].sort());
    const officeMine = await m.client.qaReworkTransfer.count({
      where: { AND: [{ id: { startsWith: tag } }, reworkScopeWhere({ id: id("ops"), role: "OPS_MANAGER" }, "mine")] },
    });
    expect(officeMine).toBe(0);
  });

  it("keeps a Fail in the severity grouping (database CHECKs)", async () => {
    const base = {
      jobId: id("job-r1"),
      propertyId: id("prop"),
      cleanerId: id("cl"),
      raisedById: id("qa"),
      category: "other",
      description: "fixture",
    };
    await expect(m.client.qaIssue.create({ data: { ...base, severity: "MAJOR", failVerdict: true } })).resolves.toBeTruthy();
    await expect(
      m.client.qaIssue.create({ data: { ...base, severity: "CRITICAL", failVerdict: true, serious: true } })
    ).resolves.toBeTruthy();
    await expect(m.client.qaIssue.create({ data: { ...base, severity: "MINOR", failVerdict: true } })).rejects.toThrow();
    await expect(m.client.qaIssue.create({ data: { ...base, severity: "CRITICAL", serious: true } })).rejects.toThrow();
  });
});
