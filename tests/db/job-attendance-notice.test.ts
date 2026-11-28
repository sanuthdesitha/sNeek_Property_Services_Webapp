// @vitest-environment node
/**
 * "I can't attend" / "Running late" on PostgreSQL (pilot "Before-you-start
 * extras"): an audit row on the job, inbox notices to the office (never email
 * or SMS), a retry is the same notice, refused after clock-in, and nothing on
 * the job changes.
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

import { sendAttendanceNotice } from "@/lib/jobs/attendance-notice";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `jan-${randomUUID().slice(0, 8)}`;
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

describe.skipIf(!url)("I can't attend / Running late (PostgreSQL)", () => {
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
    await m.client.timeLog.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.job.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: { in: USERS } } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("running late: audited on the job, the office told in the inbox only; a retry is the same notice; the job is unchanged", async () => {
    await job("a", { status: "ASSIGNED" });
    const input = { kind: "RUNNING_LATE", requestKey: key("a1"), reason: "Traffic on the bridge", minutes: 20 };
    const [first, second] = await Promise.all([sendAttendanceNotice(cleaner, id("a"), input, "Australia/Sydney"), sendAttendanceNotice(cleaner, id("a"), input, "Australia/Sydney")]);
    expect([first.outcome, second.outcome].sort()).toEqual(["REPLAYED", "SENT"]);
    const intents = (await m.client.notificationIntent.findMany({ where: { recipientId: { in: USERS } } })).filter((row) => row.eventKey === "job_attendance.running_late");
    expect(intents.map((row) => row.recipientId).sort()).toEqual([id("admin"), id("ops")].sort());
    expect(new Set(intents.map((row) => row.transport))).toEqual(new Set(["INBOX"]));
    expect((intents[0].envelope as { subject?: string }).subject).toContain("20 min late");
    const audit = await m.client.auditLog.findMany({ where: { jobId: id("a"), action: "JOB_CLEANER_RUNNING_LATE" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(id("cleaner"));
    const after = await m.client.job.findUniqueOrThrow({ where: { id: id("a") }, include: { assignments: true } });
    expect(after.status).toBe("ASSIGNED");
    expect(after.assignments.every((row) => row.removedAt === null)).toBe(true);
  });

  it("can't attend: refused for a cleaner not on the job, after clock-in, or on a started job", async () => {
    await job("b", { status: "ASSIGNED" });
    const input = (k: string) => ({ kind: "CANT_ATTEND", requestKey: key(k), reason: "Sick today" });
    await expect(sendAttendanceNotice({ id: id("stranger") }, id("b"), input("b1"), "UTC")).rejects.toMatchObject({ status: 403 });
    await m.client.timeLog.create({ data: { jobId: id("b"), userId: id("cleaner"), startedAt: new Date() } });
    await expect(sendAttendanceNotice(cleaner, id("b"), input("b2"), "UTC")).rejects.toMatchObject({ code: "ALREADY_STARTED" });
    await job("c", { status: "IN_PROGRESS" });
    await expect(sendAttendanceNotice(cleaner, id("c"), input("c1"), "UTC")).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(await sendAttendanceNotice({ id: id("partner") }, id("b"), input("b3"), "UTC")).toMatchObject({ outcome: "SENT" });
  });
});
