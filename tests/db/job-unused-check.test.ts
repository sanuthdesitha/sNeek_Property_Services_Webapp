// @vitest-environment node
/**
 * "Looks unused — ask the office" on PostgreSQL (2026-11-28): one open
 * question per job, a double tap or retry returns the same row, the office
 * answers once with the actual person and role recorded, both sides are told
 * through the notification intent pipeline (inbox rows with the phone push
 * category, never email or SMS), and the answer never changes the job's
 * status, schedule or price.
 * Run with SNEEK_TEST_DATABASE_URL pointing at a migrated disposable database.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));

import { answerUnusedCheck, askUnusedCheck, listUnusedChecksForCleaner, UnusedCheckError } from "@/lib/jobs/unused-check";
import { deliverInboxIntentsNow } from "@/lib/notifications/inline-dispatch";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `juc-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const USERS = ["admin", "ops", "cleaner", "partner", "stranger"].map(id);
const cleaner = { id: id("cleaner"), role: "CLEANER" as const };
const admin = { id: id("admin"), role: "ADMIN" as const };
const ops = { id: id("ops"), role: "OPS_MANAGER" as const };
const key = (name: string) => `${tag}-${name}`.replace(/[^A-Za-z0-9_-]/g, "");

async function job(name: string, data: { jobType?: "AIRBNB_TURNOVER" | "GENERAL_CLEAN"; status?: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED"; responseStatus?: "ACCEPTED" | "PENDING" } = {}) {
  return m.client.job.create({
    data: {
      id: id(name),
      jobNumber: id(name),
      propertyId: id("property"),
      jobType: data.jobType ?? "AIRBNB_TURNOVER",
      status: data.status ?? "IN_PROGRESS",
      fixedPrice: 120,
      scheduledDate: new Date("2026-11-28T00:00:00Z"),
      startTime: "10:00",
      assignments: {
        create: [
          { userId: id("cleaner"), responseStatus: data.responseStatus ?? "ACCEPTED" },
          { userId: id("partner"), responseStatus: "ACCEPTED" },
        ],
      },
    },
  });
}

async function intentsFor(entityId: string) {
  const rows = await m.client.notificationIntent.findMany({ where: { recipientId: { in: USERS } } });
  return rows.filter((row) => (row.envelope as { entity?: { id?: string } }).entity?.id === entityId);
}

describe.skipIf(!url)("Looks unused — ask the office (PostgreSQL)", () => {
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
        { id: id("partner"), email: `${id("partner")}@example.invalid`, role: "CLEANER", name: "Pat Partner" },
        { id: id("stranger"), email: `${id("stranger")}@example.invalid`, role: "CLEANER", name: "Sam Stranger" },
      ],
    });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} client` } });
    await m.client.property.create({ data: { id: id("property"), clientId: id("client"), name: `${tag} Unit 4`, address: "1 Fixture Street", suburb: "Sydney" } });
  });

  afterEach(async () => {
    await m.client.notificationAttempt.deleteMany({ where: { intent: { recipientId: { in: USERS } } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: USERS } } });
    await m.client.notification.deleteMany({ where: { userId: { in: USERS } } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: USERS } } });
    await m.client.jobUnusedCheck.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.job.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: { in: USERS } } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("asks once: the office is told in the inbox with the approvals push, never by email or SMS", async () => {
    await job("a");
    const result = await askUnusedCheck(cleaner, id("a"), { requestKey: key("a1"), note: "Beds untouched, towels folded" });
    expect(result.outcome).toBe("CREATED");
    expect(result.check).toMatchObject({ jobId: id("a"), openForJobId: id("a"), requestedById: id("cleaner"), note: "Beds untouched, towels folded", decision: null });

    const intents = await intentsFor(result.check.id);
    const recipients = intents.map((row) => row.recipientId).sort();
    expect(recipients).toEqual([id("admin"), id("ops")].sort());
    expect(new Set(intents.map((row) => row.transport))).toEqual(new Set(["INBOX"]));
    for (const row of intents) {
      const envelope = row.envelope as { recipient: { scope: unknown }; mobilePushCategory?: string; eventKey: string; body: string; url?: string };
      expect(envelope.recipient.scope).toEqual({ kind: "ENTITY", type: "JOB_OFFICE", id: id("a") });
      expect(envelope.mobilePushCategory).toBe("approvals");
      expect(envelope.eventKey).toBe("job_unused_check.asked");
      expect(envelope.body).toContain("Casey Cleaner");
      expect(envelope.body).toContain("Cleaner note: Beds untouched, towels folded");
      expect(envelope.url).toContain("queue=unusedChecks");
    }
    // Queued is not delivered: delivery puts the inbox rows in place now.
    const states = await deliverInboxIntentsNow(result.intentIds);
    expect(Array.from(states.values()).every((state) => state.state === "inbox_available")).toBe(true);
    const inbox = await m.client.notification.findMany({ where: { userId: { in: [id("admin"), id("ops")] } } });
    expect(inbox).toHaveLength(2);
    expect(inbox.every((row) => row.channel === "PUSH")).toBe(true);
    expect(await m.client.notification.count({ where: { userId: { in: USERS }, channel: { in: ["EMAIL", "SMS"] } } })).toBe(0);

    const audit = await m.client.auditLog.findFirstOrThrow({ where: { entityId: result.check.id, action: "JOB_UNUSED_CHECK_ASKED" } });
    expect(audit).toMatchObject({ userId: id("cleaner"), jobId: id("a") });
  });

  it("is idempotent on a double tap and keeps one open question per job", async () => {
    await job("b");
    const [first, second] = await Promise.all([
      askUnusedCheck(cleaner, id("b"), { requestKey: key("b1") }),
      askUnusedCheck(cleaner, id("b"), { requestKey: key("b1") }),
    ]);
    expect(first.check.id).toBe(second.check.id);
    expect([first.outcome, second.outcome].filter((outcome) => outcome === "CREATED")).toHaveLength(1);
    const replay = await askUnusedCheck(cleaner, id("b"), { requestKey: key("b1") });
    expect(replay).toMatchObject({ outcome: "REPLAYED", intentIds: [] });
    // Another cleaner on the job, a new key: still the one open question.
    const partner = await askUnusedCheck({ id: id("partner"), role: "CLEANER" }, id("b"), { requestKey: key("b2") });
    expect(partner).toMatchObject({ outcome: "ALREADY_OPEN", intentIds: [] });
    expect(partner.check.id).toBe(first.check.id);
    expect(await m.client.jobUnusedCheck.count({ where: { jobId: id("b") } })).toBe(1);
    // Two office people, each told once.
    expect((await intentsFor(first.check.id)).length).toBe(2);
    // A request key already used for another job is refused, not moved.
    await job("b-other");
    await expect(askUnusedCheck(cleaner, id("b-other"), { requestKey: key("b1") })).rejects.toMatchObject({ status: 409, code: "REQUEST_KEY_REUSED" });
  });

  it("refuses a cleaner who is not on the job, has not accepted it, a non-turnover and a finished job", async () => {
    await job("c");
    await expect(askUnusedCheck({ id: id("stranger"), role: "CLEANER" }, id("c"), { requestKey: key("c1") })).rejects.toMatchObject({ status: 403, code: "NOT_ASSIGNED" });
    await job("c-pending", { responseStatus: "PENDING" });
    await expect(askUnusedCheck(cleaner, id("c-pending"), { requestKey: key("c2") })).rejects.toMatchObject({ status: 409, code: "NOT_ELIGIBLE" });
    await job("c-general", { jobType: "GENERAL_CLEAN" });
    await expect(askUnusedCheck(cleaner, id("c-general"), { requestKey: key("c3") })).rejects.toMatchObject({ status: 409, code: "NOT_ELIGIBLE" });
    await job("c-done", { status: "COMPLETED" });
    await expect(askUnusedCheck(cleaner, id("c-done"), { requestKey: key("c4") })).rejects.toMatchObject({ status: 409, code: "NOT_ELIGIBLE" });
    // A photo someone else uploaded is not accepted as this cleaner's evidence.
    await expect(askUnusedCheck(cleaner, id("c"), { requestKey: key("c5"), photoKeys: [`evidence/${id("stranger")}/a.jpg`] })).rejects.toBeInstanceOf(UnusedCheckError);
    expect(await m.client.jobUnusedCheck.count({ where: { jobId: { startsWith: tag } } })).toBe(0);
  });

  it("answers once with the actual person and role; Do not clean leaves the job, its time and price alone", async () => {
    const created = await job("d");
    const asked = await askUnusedCheck(cleaner, id("d"), { requestKey: key("d1"), photoKeys: [`evidence/${id("cleaner")}/bed.jpg`] });
    const answered = await answerUnusedCheck(ops, asked.check.id, { decision: "DO_NOT_CLEAN", note: "Guest cancelled late" });
    expect(answered.outcome).toBe("ANSWERED");
    expect(answered.check).toMatchObject({ decision: "DO_NOT_CLEAN", decisionNote: "Guest cancelled late", decidedById: id("ops"), decidedByRole: "OPS_MANAGER", openForJobId: null });
    expect(answered.check.decidedAt).toBeInstanceOf(Date);

    const after = await m.client.job.findUniqueOrThrow({ where: { id: id("d") } });
    expect({ status: after.status, scheduledDate: after.scheduledDate, startTime: after.startTime, fixedPrice: after.fixedPrice }).toEqual({
      status: created.status, scheduledDate: created.scheduledDate, startTime: created.startTime, fixedPrice: created.fixedPrice,
    });

    // Both cleaners still on the job are told (asker first), in the inbox with the jobs push.
    const toCleaners = (await intentsFor(asked.check.id)).filter((row) => (row.envelope as { eventKey: string }).eventKey === "job_unused_check.answered");
    expect(toCleaners.map((row) => row.recipientId).sort()).toEqual([id("cleaner"), id("partner")].sort());
    for (const row of toCleaners) {
      const envelope = row.envelope as { transport: string; mobilePushCategory?: string; body: string; recipient: { scope: unknown } };
      expect(row.transport).toBe("INBOX");
      expect(envelope.mobilePushCategory).toBe("jobs");
      expect(envelope.recipient.scope).toEqual({ kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: id("d") });
      expect(envelope.body).toContain("Do not clean");
      expect(envelope.body).toContain("Note from the office: Guest cancelled late");
      expect(envelope.body).toContain("pay are not changed");
    }

    // The same answer again (double tap) is a replay; a different answer is refused.
    expect(await answerUnusedCheck(ops, asked.check.id, { decision: "DO_NOT_CLEAN", note: "Guest cancelled late" })).toMatchObject({ outcome: "REPLAYED", intentIds: [] });
    await expect(answerUnusedCheck(admin, asked.check.id, { decision: "CLEAN_AS_NORMAL" })).rejects.toMatchObject({ status: 409, code: "ALREADY_ANSWERED" });

    // The cleaner sees the answer without office identities; the job may be asked about again.
    const view = await listUnusedChecksForCleaner(id("d"), id("cleaner"));
    expect(view).toEqual([expect.objectContaining({ status: "ANSWERED", decision: "DO_NOT_CLEAN", decisionNote: "Guest cancelled late", photoCount: 1, askedByMe: true })]);
    expect(JSON.stringify(view)).not.toContain(id("ops"));
    const again = await askUnusedCheck(cleaner, id("d"), { requestKey: key("d2") });
    expect(again.outcome).toBe("CREATED");

    const audit = await m.client.auditLog.findFirstOrThrow({ where: { entityId: asked.check.id, action: "JOB_UNUSED_CHECK_ANSWERED" } });
    expect(audit).toMatchObject({ userId: id("ops"), jobId: id("d") });
  });

  it("does not tell a cleaner who was removed from the job", async () => {
    await job("e");
    const asked = await askUnusedCheck(cleaner, id("e"), { requestKey: key("e1") });
    await m.client.jobAssignment.updateMany({ where: { jobId: id("e"), userId: id("partner") }, data: { removedAt: new Date() } });
    await answerUnusedCheck(admin, asked.check.id, { decision: "LIGHT_REFRESH" });
    const toCleaners = (await intentsFor(asked.check.id)).filter((row) => (row.envelope as { eventKey: string }).eventKey === "job_unused_check.answered");
    expect(toCleaners.map((row) => row.recipientId)).toEqual([id("cleaner")]);
  });
});
