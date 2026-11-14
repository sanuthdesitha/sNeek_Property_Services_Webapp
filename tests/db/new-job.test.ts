// @vitest-environment node
/**
 * New job page against a real disposable PostgreSQL (SNEEK_TEST_DATABASE_URL,
 * loopback only): the request-key path creates exactly what the old path
 * creates (job row, rate snapshot, offer, laundry task, notifications), a
 * double submit creates one job, several dates retry only the missing days,
 * and the preview loaders write nothing.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { createAdminJob, createAdminJobOnce, NEW_JOB_RECEIPT_ACTION, NEW_JOB_RECEIPT_ENTITY } from "@/lib/jobs/admin-create";
import { loadNewJobDayCheck } from "@/lib/jobs/new-job/day-check";
import { loadNewJobPropertyFacts } from "@/lib/jobs/new-job/property-facts";
import { loadNewJobOptions } from "@/lib/jobs/new-job/options";
import { findDuplicateSources } from "@/lib/jobs/new-job/duplicate-source";
import { loadSchedulingRuleBook } from "@/lib/scheduling-rules/store";
import { getRecurringJobRules, upsertRecurringJobRule } from "@/lib/ops/recurring";
import { dayRequestKey } from "@/lib/jobs/new-job/request-key";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `nj-${randomUUID().slice(0, 8)}`;
const ids = { client: `${tag}-client`, property: `${tag}-prop`, cleaner: `${tag}-cleaner`, clientUser: `${tag}-cu`, admin: `${tag}-admin` };
const body = (day: string) => ({ propertyId: ids.property, jobType: "AIRBNB_TURNOVER" as const, scheduledDate: `${day}T00:00:00.000Z`, startTime: "10:00", dueTime: "15:00", estimatedHours: 3, isDraft: false, tags: [], attachments: [] });
const receipt = (key: string) => ({ key: `new-job:${ids.admin}:${key}`, userId: ids.admin, detail: { bodyHash: "h" }, action: NEW_JOB_RECEIPT_ACTION, entity: NEW_JOB_RECEIPT_ENTITY });
const actor = { actor: { userId: ids.admin, name: "Fixture admin" } };

async function rowsFor(jobId: string) {
  const job = await m.client.job.findUniqueOrThrow({ where: { id: jobId } });
  const { id: _id, jobNumber: _n, createdAt: _c, updatedAt: _u, ...rest } = job;
  const assignments = await m.client.jobAssignment.findMany({ where: { jobId }, select: { userId: true, isPrimary: true, payRate: true, responseStatus: true, removedAt: true } });
  const laundry = await m.client.laundryTask.count({ where: { jobId } });
  const notifications = await m.client.notification.findMany({ where: { jobId }, select: { channel: true, status: true, userId: true } });
  return { job: { ...rest, scheduledDate: rest.scheduledDate.toISOString().slice(0, 10) }, assignments, laundry, notifications };
}

async function counts() {
  const [jobs, assignments, laundry, notifications, audits, tasks, reservations, versions] = await Promise.all([
    m.client.job.count(), m.client.jobAssignment.count(), m.client.laundryTask.count(), m.client.notification.count(),
    m.client.auditLog.count(), m.client.jobTask.count(), m.client.reservation.count(), m.client.schedulingRuleVersion.count(),
  ]);
  return { jobs, assignments, laundry, notifications, audits, tasks, reservations, versions };
}

describe.skipIf(!url)("New job (database)", () => {
  beforeAll(async () => {
    delete process.env.RESEND_API_KEY;
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.client.create({ data: { id: ids.client, name: "New job fixture client" } });
    await m.client.user.createMany({ data: [
      { id: ids.admin, email: `${ids.admin}@example.invalid`, role: "ADMIN" },
      { id: ids.cleaner, name: "Fixture Cleaner", email: `${ids.cleaner}@example.invalid`, role: "CLEANER" },
      { id: ids.clientUser, email: `${ids.clientUser}@example.invalid`, role: "CLIENT", clientId: ids.client },
    ] });
    await m.client.property.create({ data: { id: ids.property, clientId: ids.client, name: "New job fixture", address: "1 Fixture St", suburb: "Bondi", preferredCleanerUserId: ids.cleaner, cleanerServiceRate: 60, assignedCleaningHours: 3, laundryEnabled: true } });
    await m.client.propertyClientRate.create({ data: { id: `${tag}-rate`, propertyId: ids.property, jobType: "AIRBNB_TURNOVER", baseCharge: 165 } });
    await m.client.reservation.createMany({ data: [
      { id: `${tag}-out`, propertyId: ids.property, uid: `${tag}-out`, startDate: new Date("2027-03-01"), endDate: new Date("2027-03-05"), reservationCode: "OUT1", adults: 2, checkoutAtLocal: new Date("2027-03-04T23:00:00Z") },
      { id: `${tag}-in`, propertyId: ids.property, uid: `${tag}-in`, startDate: new Date("2027-03-05"), endDate: new Date("2027-03-08"), reservationCode: "IN1", adults: 4, checkinAtLocal: new Date("2027-03-05T04:00:00Z") },
    ] });
    await loadSchedulingRuleBook(m.client as never);
  });

  afterAll(async () => {
    if (!m.client) return;
    const jobs = await m.client.job.findMany({ where: { propertyId: ids.property }, select: { id: true } });
    const jobIds = jobs.map((job) => job.id);
    await m.client.notification.deleteMany({ where: { jobId: { in: jobIds } } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { userId: ids.admin }] } });
    await m.client.jobTask.deleteMany({ where: { propertyId: ids.property } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } });
    await m.client.laundryTask.deleteMany({ where: { propertyId: ids.property } });
    await m.client.job.deleteMany({ where: { propertyId: ids.property } });
    await m.client.reservation.deleteMany({ where: { propertyId: ids.property } });
    await m.client.propertyClientRate.deleteMany({ where: { propertyId: ids.property } });
    await m.client.property.delete({ where: { id: ids.property } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.admin, ids.cleaner, ids.clientUser] } } });
    await m.client.client.delete({ where: { id: ids.client } });
    await m.client.$disconnect();
  });

  it("the previews read the property, calendar, clash, laundry rules and cleaners, and write nothing", async () => {
    const before = await counts();
    const options = await loadNewJobOptions();
    expect(options.properties.find((row) => row.id === ids.property)).toMatchObject({ name: "New job fixture", isActive: true });
    const facts = await loadNewJobPropertyFacts(ids.property, "AIRBNB_TURNOVER");
    expect(facts).toMatchObject({ hours: 3, clientPrice: { amount: 165, source: "PROPERTY_RATE", missing: false }, cleanerPay: { rate: 60, basis: "property_rate" }, preferredCleaner: { id: ids.cleaner, active: true } });
    const check = await loadNewJobDayCheck({ propertyId: ids.property, jobType: "AIRBNB_TURNOVER", dayKeys: ["2027-03-05"], startTime: "10:00", dueTime: "15:00", endTime: null, estimatedHours: 3, suggest: true, timezone: "Australia/Sydney" });
    const day = check!.days[0];
    expect(day.guestOut).toMatchObject({ reservationCode: "OUT1", time: "10:00", adults: 2 });
    expect(day.guestIn).toMatchObject({ reservationCode: "IN1", time: "15:00", nights: 3 });
    expect(day.windowHours).toBe(5);
    expect(day.sameDayJobs).toEqual([]);
    const book = await loadSchedulingRuleBook(m.client as never);
    expect(day.laundry).toMatchObject({ kind: "preview", rulesVersion: book.live.version, pickupDate: "2027-03-06" });
    expect(check!.suggestions.kind).toBe("ok");
    expect(check!.bookingEmail).toMatchObject({ applies: true, providerConfigured: false, recipients: [`${ids.clientUser}@example.invalid`] });
    expect(check!.bookingEmail?.blockedReason).toBeTruthy();
    expect(await counts()).toEqual(before);
  });

  it("missing values stay null, never zero", async () => {
    const facts = await loadNewJobPropertyFacts(ids.property, "DEEP_CLEAN");
    expect(facts?.clientPrice).toMatchObject({ amount: null, missing: true });
  });

  it("parity: the request-key path writes the same job, rate snapshot, offer, laundry and notifications as the old path", async () => {
    const old = await createAdminJob(body("2027-04-01"), actor);
    const fresh = await createAdminJobOnce(body("2027-04-01"), receipt(`${tag}-parity-1`), actor);
    const a = await rowsFor(old.id);
    const b = await rowsFor(fresh.jobId);
    expect(b).toEqual(a);
    expect(a.assignments).toEqual([{ userId: ids.cleaner, isPrimary: true, payRate: 60, responseStatus: "PENDING", removedAt: null }]);
    expect(a.laundry).toBe(0);
    expect(a.job.status).toBe("OFFERED");
    expect(a.notifications.length).toBeGreaterThan(0);
    expect(a.notifications.every((row) => row.channel === "EMAIL" && row.status === "FAILED")).toBe(true);
  });

  it("the second job that day is visible to the clash check", async () => {
    const check = await loadNewJobDayCheck({ propertyId: ids.property, jobType: "AIRBNB_TURNOVER", dayKeys: ["2027-04-01"], startTime: "10:00", dueTime: "15:00", endTime: null, estimatedHours: 3, suggest: true, timezone: "Australia/Sydney" });
    expect(check!.days[0].sameDayJobs).toHaveLength(2);
    const cleaner = check!.suggestions.kind === "ok" ? check!.suggestions.items.find((item) => item.cleanerId === ids.cleaner) : null;
    expect(cleaner?.blocker?.kind).toBe("clash");
  });

  it("a double submit with one key creates one job", async () => {
    const before = await m.client.job.count({ where: { propertyId: ids.property } });
    const [first, second] = await Promise.all([
      createAdminJobOnce(body("2027-04-10"), receipt(`${tag}-double`), actor),
      createAdminJobOnce(body("2027-04-10"), receipt(`${tag}-double`), actor),
    ]);
    expect(first.jobId).toBe(second.jobId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(await m.client.job.count({ where: { propertyId: ids.property } })).toBe(before + 1);
  });

  it("several dates: a retry with the batch key creates only the missing days", async () => {
    const batch = `${tag}-batch`;
    await createAdminJobOnce(body("2027-05-01"), receipt(dayRequestKey(batch, "2027-05-01")), actor);
    const before = await m.client.job.count({ where: { propertyId: ids.property } });
    const results = [];
    for (const day of ["2027-05-01", "2027-05-04", "2027-05-07"]) results.push(await createAdminJobOnce(body(day), receipt(dayRequestKey(batch, day)), actor));
    expect(results.map((row) => row.replayed)).toEqual([true, false, false]);
    expect(await m.client.job.count({ where: { propertyId: ids.property } })).toBe(before + 2);
  });

  it("leave unassigned skips the offer; do not send skips the email and records it", async () => {
    const result = await createAdminJobOnce({ ...body("2027-06-01") }, receipt(`${tag}-choices`), { ...actor, skipPreferredCleaner: true, sendBookingConfirmation: false });
    const rows = await rowsFor(result.jobId);
    expect(rows.assignments).toEqual([]);
    expect(rows.job.status).toBe("UNASSIGNED");
    expect(rows.notifications).toEqual([]);
    expect(await m.client.auditLog.count({ where: { jobId: result.jobId, action: "JOB_BOOKING_CONFIRMATION_SKIPPED" } })).toBe(1);
  });

  it("special tasks become JobTasks and the meta keeps their ids", async () => {
    const result = await createAdminJobOnce({ ...body("2027-06-05"), specialRequestTasks: [{ title: "Inside oven", requiresPhoto: true }] }, receipt(`${tag}-tasks`), actor);
    const tasks = await m.client.jobTask.findMany({ where: { jobId: result.jobId, source: "ADMIN" } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Inside oven", requiresPhoto: true, requestedByUserId: ids.admin });
    const job = await m.client.job.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(JSON.parse(job.internalNotes ?? "{}").specialRequestTasks[0].id).toBe(tasks[0].id);
  });

  it("duplicate finds the job by number", async () => {
    const job = await m.client.job.findFirstOrThrow({ where: { propertyId: ids.property } });
    const sources = await findDuplicateSources(job.jobNumber);
    expect(sources[0]).toMatchObject({ jobId: job.id, propertyId: ids.property, startTime: "10:00", estimatedHours: 3 });
  });

  it("Repeats saves one rule per id on the existing store, read back for the property", async () => {
    const rule = { id: `${tag}-rule`, name: "Fixture repeat", isActive: true, propertyId: ids.property, jobType: "AIRBNB_TURNOVER" as const, daysOfWeek: [2, 5], startTime: "10:00", estimatedHours: 3, assigneeIds: [] };
    const original = await m.client.appSetting.findUnique({ where: { key: "recurring_job_rules_v1" } });
    try {
      await upsertRecurringJobRule(rule);
      await upsertRecurringJobRule(rule);
      expect((await getRecurringJobRules()).filter((row) => row.id === rule.id)).toHaveLength(1);
    } finally {
      if (original) await m.client.appSetting.update({ where: { key: original.key }, data: { value: original.value as never } });
      else await m.client.appSetting.deleteMany({ where: { key: "recurring_job_rules_v1" } });
    }
  });
});
