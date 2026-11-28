// @vitest-environment node
/**
 * All issues register on PostgreSQL: every source read from its own records
 * into one shape (no second store), close times from the records that keep
 * them, damage-report item cases and lost-and-found left out, packs hiding a
 * source, and "Log an issue" (an internal case, idempotent under a race,
 * audited with the actor, no client visibility, no notification).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({
  getAppSettings: async () => ({ timezone: "Australia/Sydney", accountability: { issueCategories: [{ key: "bathroom", label: "Bathroom" }] } }),
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));

import { readRegister } from "@/lib/quality/register/load";
import { logRegisterIssue } from "@/lib/quality/register/log-issue";
import { REGISTER_SOURCES } from "@/lib/quality/register/model";
import { rangeFromKeys } from "@/lib/quality/period";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `reg-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const USERS = ["admin", "cleaner"].map(id);
const range = rangeFromKeys("2026-01-01", "2026-12-31");
const allSources = new Set(REGISTER_SOURCES);
const at = (iso: string) => new Date(iso);

describe.skipIf(!url)("All issues register (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    const c = m.client;
    await c.user.createMany({
      data: [
        { id: id("admin"), email: `${id("admin")}@example.invalid`, role: "ADMIN", name: "Office Admin" },
        { id: id("cleaner"), email: `${id("cleaner")}@example.invalid`, role: "CLEANER", name: "Casey Cleaner" },
      ],
    });
    await c.client.create({ data: { id: id("client"), name: `${tag} client` } });
    await c.property.create({ data: { id: id("property"), clientId: id("client"), name: `${tag} Unit 4`, address: "1 Fixture Street", suburb: "Sydney" } });
    await c.job.create({
      data: {
        id: id("job"), jobNumber: id("job"), propertyId: id("property"), jobType: "AIRBNB_TURNOVER", status: "COMPLETED", fixedPrice: 120,
        scheduledDate: at("2026-11-20T00:00:00Z"), startTime: "10:00", assignments: { create: [{ userId: id("cleaner"), responseStatus: "ACCEPTED" }] },
      },
    });
    // QA: one fixed (with the fix audit row), one open.
    await c.qaIssue.create({ data: { id: id("qa-fixed"), jobId: id("job"), propertyId: id("property"), cleanerId: id("cleaner"), raisedById: id("admin"), category: "bathroom", description: "Mirror smudged", severity: "MAJOR", rectificationStatus: "FIXED_BY_MANAGER", rectifiedById: id("admin"), createdAt: at("2026-11-20T00:00:00Z") } });
    await c.auditLog.create({ data: { userId: id("admin"), action: "QA_ISSUE_RECTIFY", entity: "QaIssue", entityId: id("qa-fixed"), createdAt: at("2026-11-21T00:00:00Z") } });
    await c.qaIssue.create({ data: { id: id("qa-open"), jobId: id("job"), propertyId: id("property"), cleanerId: id("cleaner"), raisedById: id("admin"), category: "bathroom", description: "Shower seal mould", severity: "CRITICAL", serious: true, failVerdict: true, createdAt: at("2026-11-22T00:00:00Z") } });
    // Cases: a client complaint, a damage-report item case (left out), lost and found (left out).
    await c.issueTicket.createMany({
      data: [
        { id: id("complaint"), title: "Guest found hair in bed", caseType: "CLIENT_DISPUTE", source: "CLIENT_PORTAL", severity: "HIGH", propertyId: id("property"), jobId: id("job"), createdAt: at("2026-11-23T00:00:00Z") },
        { id: id("damage-case"), title: "Damage item case", caseType: "DAMAGE", source: "DAMAGE_REPORT", propertyId: id("property"), createdAt: at("2026-11-23T00:00:00Z") },
        { id: id("lost"), title: "Lost earring", caseType: "LOST_FOUND", source: "ADMIN", propertyId: id("property"), createdAt: at("2026-11-23T00:00:00Z") },
      ],
    });
    // Damage: a closed report with its close audit row.
    await c.damageReport.create({
      data: {
        id: id("damage"), jobId: id("job"), propertyId: id("property"), reportedById: id("cleaner"), status: "CLOSED", submittedAt: at("2026-11-21T00:00:00Z"),
        items: { create: [{ area: "Kitchen", category: "Benchtop", severity: "MAJOR", description: "Chip" }, { area: "Bedroom", category: "Lamp", severity: "MINOR", description: "Bent" }] },
      },
    });
    await c.auditLog.create({ data: { userId: id("admin"), action: "DAMAGE_REPORT_CLOSED", entity: "DamageReport", entityId: id("damage"), createdAt: at("2026-11-24T00:00:00Z") } });
    // Maintenance raised by the cleaner, open.
    await c.propertyMaintenanceItem.create({ data: { id: id("maint"), propertyId: id("property"), jobId: id("job"), reportedByUserId: id("cleaner"), source: "CLEANER", category: "PLUMBING", title: "Tap drips", priority: "URGENT", createdAt: at("2026-11-25T00:00:00Z") } });
    // Stock: reported, not delivered.
    await c.urgentStockNeed.create({
      data: {
        id: id("stock"), propertyId: id("property"), itemId: "toilet-paper", propertyName: `${tag} Unit 4`, itemName: "Toilet paper", unit: "roll", stage: "REPORTED", version: 1,
        observationDisposition: "NONE", note: "Only one roll left", reportedById: id("cleaner"), reportedByName: "Casey Cleaner", createdAt: at("2026-11-26T00:00:00Z"), updatedAt: at("2026-11-26T00:00:00Z"),
      },
    });
  });

  afterEach(async () => {
    const c = m.client;
    await c.auditLog.deleteMany({ where: { userId: { in: USERS } } });
    await c.issueTicket.deleteMany({ where: { propertyId: id("property") } });
    await c.urgentStockNeed.deleteMany({ where: { propertyId: id("property") } });
    await c.propertyMaintenanceItem.deleteMany({ where: { propertyId: id("property") } });
    await c.damageItem.deleteMany({ where: { reportId: id("damage") } });
    await c.damageReport.deleteMany({ where: { propertyId: id("property") } });
    await c.qaIssue.deleteMany({ where: { propertyId: id("property") } });
    await c.jobAssignment.deleteMany({ where: { jobId: id("job") } });
    await c.job.deleteMany({ where: { id: id("job") } });
    await c.property.deleteMany({ where: { id: id("property") } });
    await c.client.deleteMany({ where: { id: id("client") } });
    await c.user.deleteMany({ where: { id: { in: USERS } } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("reads every source into one shape, with close times from the records that keep them", async () => {
    const { rows, sources } = await readRegister({ range, propertyId: id("property"), allowed: allSources });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(Array.from(byKey.keys()).sort()).toEqual(
      [`QA_INSPECTION:${id("qa-fixed")}`, `QA_INSPECTION:${id("qa-open")}`, `CLIENT_COMPLAINT:${id("complaint")}`, `DAMAGE:${id("damage")}`, `MAINTENANCE:${id("maint")}`, `STOCK:${id("stock")}`].sort(),
    );
    expect(byKey.get(`QA_INSPECTION:${id("qa-fixed")}`)).toMatchObject({ open: false, closedAt: "2026-11-21T00:00:00.000Z", closedBy: "Office Admin", categoryLabel: "Bathroom", clientName: `${tag} client` });
    expect(byKey.get(`QA_INSPECTION:${id("qa-open")}`)).toMatchObject({ open: true, severity: "CRITICAL", severityLabel: "Fail, serious" });
    expect(byKey.get(`CLIENT_COMPLAINT:${id("complaint")}`)).toMatchObject({ open: true, cleaners: [{ id: id("cleaner"), name: "Casey Cleaner" }], jobNumber: id("job") });
    expect(byKey.get(`DAMAGE:${id("damage")}`)).toMatchObject({ open: false, closedAt: "2026-11-24T00:00:00.000Z", severity: "HIGH", title: "Benchtop — Kitchen (+1 more)", href: `/v2/admin/damage/${id("damage")}` });
    expect(byKey.get(`MAINTENANCE:${id("maint")}`)).toMatchObject({ severity: "CRITICAL", cleaners: [{ id: id("cleaner"), name: "Casey Cleaner" }] });
    expect(byKey.get(`STOCK:${id("stock")}`)).toMatchObject({ open: true, severity: null, category: "stock-supplies" });
    expect(sources.every((state) => state.state === "ok")).toBe(true);
  });

  it("a source the packs do not include is hidden, not zero", async () => {
    const { rows, sources } = await readRegister({ range, propertyId: id("property"), allowed: new Set(["QA_INSPECTION"]) });
    expect(new Set(rows.map((row) => row.source))).toEqual(new Set(["QA_INSPECTION"]));
    expect(sources.find((state) => state.source === "DAMAGE")).toEqual({ source: "DAMAGE", state: "hidden", read: null, truncated: false });
  });

  it("log an issue: an internal case the register lists; two taps with one key make one case; audited; no notification", async () => {
    const input = {
      requestKey: `${tag}-log-1`, kind: "CLIENT_COMPLAINT", propertyId: id("property"), jobNumber: id("job"), cleanerId: id("cleaner"),
      category: "bathroom", severity: "HIGH", description: "Client called: towels left on floor", receivedOn: "2026-11-27", raisedBy: "Client (phone)",
    };
    const actor = { id: id("admin"), role: "ADMIN" };
    const [first, second] = await Promise.all([logRegisterIssue(actor, input), logRegisterIssue(actor, input)]);
    expect(first.caseId).toBe(second.caseId);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    const saved = await m.client.issueTicket.findUniqueOrThrow({ where: { id: first.caseId } });
    expect(saved).toMatchObject({ caseType: "CLIENT_DISPUTE", source: "ISSUES_REGISTER", clientVisible: false, clientCanReply: false, jobId: id("job"), clientId: id("client") });
    expect(await m.client.auditLog.count({ where: { action: "ISSUE_REGISTER_LOGGED", entityId: first.caseId, userId: id("admin") } })).toBe(1);
    expect(await m.client.notificationIntent.count({ where: { recipientId: { in: USERS } } })).toBe(0);

    const { rows } = await readRegister({ range, propertyId: id("property"), allowed: allSources });
    expect(rows.find((row) => row.recordId === first.caseId)).toMatchObject({
      source: "CLIENT_COMPLAINT", categoryLabel: "Bathroom", cleaners: [{ id: id("cleaner"), name: "Casey Cleaner" }], detail: "Received 2026-11-27, raised by Client (phone)",
    });
  });

  it("log an issue: refuses a job at another property, a non-cleaner, a future date and someone else's upload", async () => {
    const base = { requestKey: `${tag}-log-2`, kind: "OFFICE", propertyId: id("property"), category: "bathroom", severity: "LOW", description: "Bins not out", receivedOn: "2026-11-27", raisedBy: "Office" };
    const actor = { id: id("admin"), role: "ADMIN" };
    await expect(logRegisterIssue(actor, { ...base, jobNumber: "NO-SUCH-JOB" })).rejects.toMatchObject({ status: 400 });
    await expect(logRegisterIssue(actor, { ...base, cleanerId: id("admin") })).rejects.toMatchObject({ status: 400 });
    await expect(logRegisterIssue(actor, { ...base, receivedOn: "2099-01-01" })).rejects.toMatchObject({ status: 400 });
    await expect(logRegisterIssue(actor, { ...base, photos: [{ s3Key: `cases/${id("cleaner")}/x.jpg` }] })).rejects.toMatchObject({ status: 400 });
    expect(await m.client.issueTicket.count({ where: { source: "ISSUES_REGISTER", propertyId: id("property") } })).toBe(0);
  });
});
