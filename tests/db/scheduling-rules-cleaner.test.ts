// @vitest-environment node
/**
 * A broken rule store never blocks a cleaner (owner decision 2026-11-14):
 * the cleaner's own save commits, the laundry run is not planned, the reason is
 * recorded on the job (audit + job page notice), and the hourly retry plans the
 * run and records the cleaner's outcome once the rules can be read again.
 * Real disposable PostgreSQL (SNEEK_TEST_DATABASE_URL, loopback only).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: vi.fn(async () => undefined) }));

import { DEFAULT_SETTINGS } from "@/lib/settings";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";
import { retryUnplannedLaundryRuns } from "@/lib/scheduling-rules/unplanned-laundry-retry";
import { readUnplannedLaundry, UNPLANNED_LAUNDRY_TEXT, unplannedLaundryKey } from "@/lib/scheduling-rules/unplanned-laundry";
import { SchedulingRulesUnavailableError } from "@/lib/scheduling-rules/store";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const id = `sched-cleaner-${randomUUID().slice(0, 8)}`;

async function resetRules() {
  await m.client.schedulingRuleSnapshot.deleteMany({});
  await m.client.schedulingRuleVersion.deleteMany({});
}

describe.skipIf(!url)("cleaner laundry outcome with an unreadable rule store", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
    await resetRules();
    await m.client.appSetting.upsert({ where: { key: "app" }, create: { key: "app", value: DEFAULT_SETTINGS as any }, update: { value: DEFAULT_SETTINGS as any } });
    await m.client.client.create({ data: { id, name: "Rules fixture" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER" } });
    await m.client.user.create({ data: { id: `${id}-admin`, email: `${id}-admin@example.invalid`, role: "ADMIN" } });
    await m.client.property.create({ data: { id, clientId: id, name: "Rules fixture", address: "1 Fixture Street", suburb: "Sydney", laundryEnabled: true } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "AIRBNB_TURNOVER", status: "IN_PROGRESS", scheduledDate: new Date("2026-11-20T00:00:00Z") } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.appSetting.deleteMany({ where: { key: unplannedLaundryKey(id) } });
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId: id } } });
    await m.client.laundryTask.deleteMany({ where: { jobId: id } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ jobId: id }, { userId: { in: [id, `${id}-admin`] } }, { entity: "SchedulingRules" }] } });
    await m.client.job.deleteMany({ where: { id } });
    await m.client.property.deleteMany({ where: { id } });
    await m.client.user.deleteMany({ where: { id: { in: [id, `${id}-admin`] } } });
    await m.client.client.deleteMany({ where: { id } });
    await resetRules();
    await m.client.$disconnect();
  });

  it("saves the cleaner's submission, records the reason, and plans the run later", async () => {
    // A damaged store: version 1 with a wrong checksum.
    await m.client.schedulingRuleVersion.create({ data: { version: 1, kind: "ORIGINAL", values: {}, schemaVersion: 1, checksum: "bad", effectiveFrom: "2000-01-01", reason: "damaged fixture" } });

    const result = await m.client.$transaction(async (tx) => {
      // The cleaner's own save in the same transaction (stands in for the submission).
      await tx.job.update({ where: { id }, data: { status: "SUBMITTED" } });
      return applyCleanerLaundryStatusUpdate(
        { jobId: id, cleanerId: id, laundryOutcome: "NO_PICKUP_REQUIRED", laundrySkipReasonCode: "NO_LINEN_ON_SITE", laundrySkipReasonNote: null, source: "FINAL_SUBMISSION", portalUrl: "https://example.invalid/laundry" },
        { transaction: tx, afterCommit: [] },
      );
    });

    expect(result).toMatchObject({ ok: true, laundryTask: null, laundryRunNotPlanned: UNPLANNED_LAUNDRY_TEXT });
    expect((await m.client.job.findUnique({ where: { id } }))?.status).toBe("SUBMITTED");
    expect(await m.client.laundryTask.count({ where: { jobId: id } })).toBe(0);
    const pending = await readUnplannedLaundry(m.client, id);
    expect(pending).toMatchObject({ laundryOutcome: "NO_PICKUP_REQUIRED", source: "FINAL_SUBMISSION" });
    expect(pending?.reason).toMatch(/checksum|validation/);
    expect(await m.client.auditLog.count({ where: { jobId: id, action: "LAUNDRY_RUN_NOT_PLANNED" } })).toBe(1);

    // Still unreadable: the retry plans nothing and keeps the outcome.
    await expect(retryUnplannedLaundryRuns()).rejects.toBeInstanceOf(SchedulingRulesUnavailableError);
    expect(await readUnplannedLaundry(m.client, id)).not.toBeNull();

    // Readable again (version 1 re-seeded from the live settings): the run is planned with the outcome.
    await resetRules();
    expect(await retryUnplannedLaundryRuns()).toMatchObject({ pending: 1, planned: 1, failed: 0 });
    const task = await m.client.laundryTask.findUnique({ where: { jobId: id } });
    expect(task).toMatchObject({ status: "SKIPPED_PICKUP", noPickupRequired: true, skipReasonCode: "NO_LINEN_ON_SITE" });
    expect(await readUnplannedLaundry(m.client, id)).toBeNull();
    expect(await m.client.auditLog.count({ where: { entityId: id, action: "LAUNDRY_RUN_PLANNED_AFTER_RETRY" } })).toBe(1);
  });
});
