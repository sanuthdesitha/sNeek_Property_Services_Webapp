// @vitest-environment node
/**
 * "Camera not working — ask the office" on PostgreSQL (cleaner job flow v2,
 * item 2): one open request per job, a double tap or retry returns the same
 * row, the office decides once with a reason and the actual person and role
 * recorded, only the requested photos can be allowed, and both sides are told
 * through the intent pipeline (inbox rows, never email or SMS).
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

import { allowedEvidenceFields, askEvidenceOverride, decideEvidenceOverride, EvidenceOverrideError, listEvidenceOverridesForOffice } from "@/lib/jobs/evidence-override";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `jeo-${randomUUID().slice(0, 8)}`;
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

describe.skipIf(!url)("Camera not working — ask the office (PostgreSQL)", () => {
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
    await m.client.jobEvidenceOverride.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { startsWith: tag } } });
    await m.client.job.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.user.deleteMany({ where: { id: { in: USERS } } });
  });

  afterAll(async () => m.client?.$disconnect());

  const ask = (name: string, extra: Record<string, unknown> = {}) =>
    askEvidenceOverride(cleaner, id(name), { requestKey: key(`${name}-1`), note: "Camera shows black", fields: [{ fieldId: "bench", label: "Bench photo" }, { fieldId: "oven", label: "Oven photo" }], ...extra });

  it("asks once per job; a double tap returns the same row; the office is told in the inbox only", async () => {
    await job("a");
    const [first, second] = await Promise.all([ask("a"), ask("a")]);
    expect(first.request.id).toBe(second.request.id);
    expect([first.outcome, second.outcome].sort()).toEqual(["CREATED", "REPLAYED"]);
    expect(first.request).toMatchObject({ status: "REQUESTED", openForJobId: id("a"), fieldIds: ["bench", "oven"], fieldLabels: ["Bench photo", "Oven photo"] });
    const intents = await intentsFor(first.request.id);
    expect(intents.map((row) => row.recipientId).sort()).toEqual([id("admin"), id("ops")].sort());
    expect(new Set(intents.map((row) => row.transport))).toEqual(new Set(["INBOX"]));
    const other = await ask("a", { requestKey: key("a-2") });
    expect(other.outcome).toBe("ALREADY_OPEN");
    expect(other.request.id).toBe(first.request.id);
  });

  it("refuses a cleaner not on the job and a finished job", async () => {
    await job("b");
    await expect(askEvidenceOverride({ id: id("stranger"), role: "CLEANER" }, id("b"), { requestKey: key("b-s"), note: "Camera shows black", fields: [{ fieldId: "x", label: "X" }] })).rejects.toMatchObject({ status: 403 });
    await job("c", { status: "COMPLETED" });
    await expect(ask("c")).rejects.toBeInstanceOf(EvidenceOverrideError);
  });

  it("allows only requested photos, once, recorded with the actual person and role; the cleaner is told", async () => {
    await job("d");
    const asked = await ask("d");
    await expect(decideEvidenceOverride(ops, asked.request.id, { decision: "ALLOW", allowedFieldIds: ["stove"], reason: "Phone broken" })).rejects.toMatchObject({ code: "FIELD_NOT_REQUESTED" });
    const decided = await decideEvidenceOverride(ops, asked.request.id, { decision: "ALLOW", allowedFieldIds: ["bench"], reason: "Phone broken" });
    expect(decided.request).toMatchObject({ status: "ALLOWED", allowedFieldIds: ["bench"], decidedById: id("ops"), decidedByRole: "OPS_MANAGER", openForJobId: null });
    expect(await allowedEvidenceFields(m.client, id("d"))).toEqual(["bench"]);
    const replay = await decideEvidenceOverride(ops, asked.request.id, { decision: "ALLOW", allowedFieldIds: ["bench"], reason: "Phone broken" });
    expect(replay.outcome).toBe("REPLAYED");
    await expect(decideEvidenceOverride(admin, asked.request.id, { decision: "DECLINE", reason: "Changed my mind" })).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    const told = await intentsFor(asked.request.id);
    expect(told.filter((row) => row.recipientId === id("cleaner")).map((row) => row.transport)).toEqual(["INBOX"]);
    const audit = await m.client.auditLog.findMany({ where: { entityId: asked.request.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => [row.action, row.userId])).toEqual([["JOB_EVIDENCE_OVERRIDE_ASKED", id("cleaner")], ["JOB_EVIDENCE_OVERRIDE_ALLOWED", id("ops")]]);
    const [view] = await listEvidenceOverridesForOffice(id("d"));
    expect(view).toMatchObject({ requestedByName: "Casey Cleaner", decidedByName: "Office Ops", decisionReason: "Phone broken" });
  });

  it("a declined request waives nothing and a new request can then be asked", async () => {
    await job("e");
    const asked = await ask("e");
    await decideEvidenceOverride(admin, asked.request.id, { decision: "DECLINE", reason: "Please retake" });
    expect(await allowedEvidenceFields(m.client, id("e"))).toEqual([]);
    const again = await ask("e", { requestKey: key("e-2") });
    expect(again.outcome).toBe("CREATED");
  });
});
