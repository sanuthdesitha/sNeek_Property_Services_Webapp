// @vitest-environment node
/**
 * Smart property reminders on PostgreSQL (item 9, slice A): the office adds,
 * edits and ends a reminder with the actual actor audited; a stale edit is
 * refused; two jobs clocking in at once use a "next job" reminder exactly
 * once; confirmations are per job and person and idempotent.
 * Run with SNEEK_TEST_DATABASE_URL pointing at a migrated disposable database.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));

import { createPropertyReminder, listPropertyReminders, patchPropertyReminder, ReminderServiceError } from "@/lib/properties/reminders/service";
import { loadJobReminders, recordReminderStart } from "@/lib/properties/reminders/load";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `prm-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const USERS = ["admin", "ops", "cleaner", "other"].map(id);
const admin = { id: id("admin"), role: "ADMIN" as const };
const ops = { id: id("ops"), role: "OPS_MANAGER" as const };

describe.skipIf(!url)("smart property reminders (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    await m.client.user.createMany({
      data: [
        { id: id("admin"), email: `${id("admin")}@example.invalid`, role: "ADMIN", name: "Office Admin" },
        { id: id("ops"), email: `${id("ops")}@example.invalid`, role: "OPS_MANAGER", name: "Office Ops" },
        { id: id("cleaner"), email: `${id("cleaner")}@example.invalid`, role: "CLEANER", name: "Casey Cleaner" },
        { id: id("other"), email: `${id("other")}@example.invalid`, role: "CLEANER", name: "Olly Other" },
      ],
    });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} client` } });
    await m.client.property.create({ data: { id: id("property"), clientId: id("client"), name: `${tag} Unit 4`, address: "1 Fixture Street", suburb: "Sydney" } });
  });

  afterEach(async () => {
    await m.client.auditLog.deleteMany({ where: { userId: { in: USERS } } });
    await m.client.propertyReminderAck.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.propertyReminderClaim.deleteMany({ where: { propertyId: id("property") } });
    await m.client.propertyReminder.deleteMany({ where: { propertyId: id("property") } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: { in: USERS } } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("adds, edits and ends with the actual actor audited; ended stays readable", async () => {
    const { id: reminderId } = await createPropertyReminder(ops, id("property"), { text: "Wipe the rangehood top", moment: "ROOM", roomKey: "kitchen", lifetime: "EVERY_JOB", mustConfirm: true, reason: "Client complaint 3 Nov" });
    let view = await listPropertyReminders(id("property"));
    expect(view.active).toHaveLength(1);
    expect(view.active[0]).toMatchObject({ text: "Wipe the rangehood top", moment: "ROOM", roomLabel: "Kitchen", mustConfirm: true, why: "From the office: Client complaint 3 Nov", createdBy: "Office Ops", endsLabel: "Every job until someone ends it" });

    const edited = await patchPropertyReminder(admin, id("property"), reminderId, {
      action: "edit",
      expectedUpdatedAt: view.active[0].updatedAt,
      reminder: { text: "Wipe the rangehood top and filter", moment: "ROOM", roomKey: "kitchen", lifetime: "NEXT_JOBS", jobsCount: 2, mustConfirm: true },
    });
    await expect(
      patchPropertyReminder(admin, id("property"), reminderId, { action: "end", expectedUpdatedAt: view.active[0].updatedAt }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    await patchPropertyReminder(admin, id("property"), reminderId, { action: "end", expectedUpdatedAt: edited.updatedAt });

    view = await listPropertyReminders(id("property"));
    expect(view.active).toEqual([]);
    expect(view.ended[0]).toMatchObject({ text: "Wipe the rangehood top and filter", endedBy: "Office Admin" });
    const audits = await m.client.auditLog.findMany({ where: { entity: "PropertyReminder", entityId: reminderId }, orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => [row.action, row.userId])).toEqual([
      ["PROPERTY_REMINDER_CREATED", id("ops")],
      ["PROPERTY_REMINDER_EDITED", id("admin")],
      ["PROPERTY_REMINDER_ENDED", id("admin")],
    ]);
    expect((audits[0].after as { actorRole?: string }).actorRole).toBe("OPS_MANAGER");
  });

  it("refuses a past end date, an unknown cleaner and a room reminder without a room", async () => {
    await expect(createPropertyReminder(admin, id("property"), { text: "x", moment: "BEFORE_START", lifetime: "UNTIL_DATE", untilDate: "2000-01-01" })).rejects.toBeInstanceOf(ReminderServiceError);
    await expect(createPropertyReminder(admin, id("property"), { text: "x", moment: "BEFORE_START", lifetime: "EVERY_JOB", cleanerId: id("admin") })).rejects.toMatchObject({ code: "CLEANER_NOT_FOUND" });
    await expect(createPropertyReminder(admin, id("property"), { text: "x", moment: "ROOM", lifetime: "EVERY_JOB" })).rejects.toThrow();
  });

  it("two jobs clocking in at once use a next-job reminder exactly once; the confirmations are per job and person", async () => {
    await createPropertyReminder(admin, id("property"), { text: "Check the balcony door is locked", moment: "BEFORE_START", lifetime: "NEXT_JOBS", jobsCount: 1 });
    const before = await loadJobReminders({ propertyId: id("property"), jobId: id("job-a"), userId: id("cleaner") });
    expect(before).toHaveLength(1);
    const briefingId = before[0].briefingId;
    await Promise.all([
      recordReminderStart({ jobId: id("job-a"), propertyId: id("property"), userId: id("cleaner"), reminders: before, acknowledgedBriefingIds: [briefingId] }),
      recordReminderStart({ jobId: id("job-b"), propertyId: id("property"), userId: id("other"), reminders: before, acknowledgedBriefingIds: [briefingId] }),
    ]);
    const claims = await m.client.propertyReminderClaim.findMany({ where: { propertyId: id("property") } });
    expect(claims).toHaveLength(1);
    const winner = claims[0].jobId;
    const loser = winner === id("job-a") ? id("job-b") : id("job-a");
    expect(await loadJobReminders({ propertyId: id("property"), jobId: winner, userId: id("cleaner") })).toHaveLength(1);
    expect(await loadJobReminders({ propertyId: id("property"), jobId: loser, userId: id("cleaner") })).toEqual([]);
    const acks = await m.client.propertyReminderAck.findMany({ where: { jobId: winner } });
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ moment: "BEFORE_START", text: "Check the balcony door is locked" });
    expect(await m.client.propertyReminderAck.count({ where: { jobId: loser } })).toBe(0);

    // Repeating the start record changes nothing.
    await recordReminderStart({ jobId: winner, propertyId: id("property"), userId: acks[0].userId, reminders: before, acknowledgedBriefingIds: [briefingId] });
    expect(await m.client.propertyReminderAck.count({ where: { jobId: winner } })).toBe(1);
    const view = await listPropertyReminders(id("property"));
    expect(view.active[0]).toMatchObject({ usedOnJobs: 1, confirmations: 1, endsLabel: "Next job only: used", finished: true });
  });
});
