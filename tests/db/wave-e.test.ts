// @vitest-environment node
/**
 * Wave E (People, Jobs, Calendar, Quality) on a real PostgreSQL database:
 *  - effective-dated pay rates: the rate on each job's day, future rates never
 *    reaching earlier jobs, assignment snapshots and payouts untouched, future
 *    rows removable, rows in force never;
 *  - Cancel job: every rule and refusal, released assignments, exclusion from
 *    billing (even with time logged), the Jobs list default and the calendar,
 *    and Restore back to the unstarted status with its cleaners;
 *  - leave: suggestions and assignment conflicts treat it as unavailable;
 *  - QA inspections read their stored template copy after the template changes.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({
  getAppSettings: async () => ({ pricing: { gstEnabled: false }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney", cleanerJobHourlyRates: {}, qaPay: { defaultMode: "NONE" } }),
  getTransactionAppSettings: async () => ({}),
}));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `fixture-${randomUUID()}` }));
vi.mock("@/lib/accounts/availability", () => ({ listCleanerAvailabilities: async () => [] }));

import { updateHourlyRate, removeFuturePayRate, loadPayRateBook, PayRateError } from "@/lib/accounts/pay-rate";
import { listPayRateHistory } from "@/lib/accounts/pay-rate-history";
import { getPayrollSummary } from "@/lib/finance/payroll";
import { cancelJob, restoreJob, JobCancelError } from "@/lib/jobs/cancel";
import { restoreSlotConflicts } from "@/lib/jobs/cancel-flow";
import { generateClientInvoice } from "@/lib/billing/client-invoices";
import { buildJobsWhere } from "@/lib/jobs/list-filters";
import { loadCalendarRange } from "@/lib/calendar/load";
import { createLeave, removeLeave } from "@/lib/accounts/leave";
import { assignmentLeaveConflicts } from "@/lib/accounts/leave-conflicts";
import { loadCleanerSuggestions } from "@/lib/jobs/cleaner-suggestions-load";
import { exactTemplateCopy, inspectionTemplateSchema } from "@/lib/qa/inspection-template";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const today = sydneyTodayKey();
const dayDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const admin = () => ({ id: `${id}-admin`, isAdmin: true });
const ops = () => ({ id: `${id}-ops`, isAdmin: false });

async function job(suffix: string, status: string, day: string = addDaysToKey(today, 3), extra: Record<string, unknown> = {}) {
  const jobId = `${id}-${suffix}`;
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId: id, jobType: "GENERAL_CLEAN", status: status as never, scheduledDate: dayDate(day), estimatedHours: 2, fixedPrice: 100, ...extra } });
  return jobId;
}

async function assign(jobId: string, userId = `${id}-cleaner`, payRate: number | null = null) {
  await m.client.jobAssignment.create({ data: { jobId, userId, isPrimary: true, payRate, responseStatus: "ACCEPTED" } });
}

describe.skipIf(!url)("Wave E on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `wve-${randomUUID()}`;
    await m.client.client.create({ data: { id, name: "Wave E fixture" } });
    await m.client.user.createMany({ data: [
      { id: `${id}-admin`, email: `${id}-admin@example.invalid`, role: "ADMIN", isActive: true },
      { id: `${id}-ops`, email: `${id}-ops@example.invalid`, role: "OPS_MANAGER", isActive: true },
      { id: `${id}-cleaner`, email: `${id}-cleaner@example.invalid`, name: "Wave Cleaner", role: "CLEANER", isActive: true, hourlyRate: 30 },
    ] });
    await m.client.property.create({ data: { id, clientId: id, name: "Fixture property", address: "1 Test Street", suburb: "Sydney" } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    const users = [`${id}-admin`, `${id}-ops`, `${id}-cleaner`];
    await m.client.auditLog.deleteMany({ where: { userId: { in: users } } });
    await m.client.clientInvoiceLine.deleteMany({ where: { invoice: { clientId: id } } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: id } });
    await m.client.qaFormSubmission.deleteMany({ where: { job: { propertyId: id } } });
    await m.client.qaFormTemplate.deleteMany({ where: { name: { startsWith: id } } });
    await m.client.timeLog.deleteMany({ where: { job: { propertyId: id } } });
    await m.client.jobAssignment.deleteMany({ where: { job: { propertyId: id } } });
    await m.client.job.deleteMany({ where: { propertyId: id } });
    await m.client.payrollRun.deleteMany({ where: { createdByUserId: `${id}-admin` } });
    await m.client.userPayRate.deleteMany({ where: { userId: { in: users } } });
    await m.client.staffLeave.deleteMany({ where: { userId: { in: users } } });
    await m.client.property.deleteMany({ where: { clientId: id } });
    await m.client.user.deleteMany({ where: { id: { in: users } } });
    await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => m.client?.$disconnect());

  describe("effective-dated pay rate", () => {
    it("applies a future rate only from its day, keeps earlier jobs, snapshots and payouts unchanged", async () => {
      const cleaner = `${id}-cleaner`;
      const from = addDaysToKey(today, 2);
      const before = await job("before", "COMPLETED", today);
      const after = await job("after", "COMPLETED", addDaysToKey(today, 4));
      const snap = await job("snap", "COMPLETED", addDaysToKey(today, 4));
      await assign(before);
      await assign(after);
      await assign(snap, cleaner, 25);
      const change = await updateHourlyRate(`${id}-admin`, cleaner, 40, { appliesFrom: from });
      expect(change).toMatchObject({ before: 30, after: 40, appliesFrom: from, changed: true });
      // The stored rate is the one in force today; the future one is history.
      expect((await m.client.user.findUniqueOrThrow({ where: { id: cleaner } })).hourlyRate).toBe(30);
      const book = await loadPayRateBook([cleaner]);
      expect(book.rateFor(cleaner, dayDate(today), 30)).toBe(30);
      expect(book.rateFor(cleaner, dayDate(addDaysToKey(today, 1)), 30)).toBe(30);
      expect(book.rateFor(cleaner, dayDate(from), 30)).toBe(40);
      // A past job from long ago still resolves to the rate it always had.
      expect(book.rateFor(cleaner, dayDate("2025-01-01"), 30)).toBe(30);

      const summary = await getPayrollSummary({ startDate: today, endDate: addDaysToKey(today, 5) });
      const row = summary.find((entry) => entry.cleaner.id === cleaner)!;
      const rates = Object.fromEntries(row.jobs.map((line) => [line.id, line.rate]));
      expect(rates[before]).toBe(30);
      expect(rates[after]).toBe(40);
      expect(rates[snap]).toBe(25);
      const snapshot = await m.client.jobAssignment.findFirstOrThrow({ where: { jobId: snap } });
      expect(snapshot.payRate).toBe(25);
    });

    it("never backdates, removes only a future row (tombstone), keeps rows in force", async () => {
      const cleaner = `${id}-cleaner`;
      await expect(updateHourlyRate(`${id}-admin`, cleaner, 41, { appliesFrom: addDaysToKey(today, -1) })).rejects.toBeInstanceOf(PayRateError);
      await updateHourlyRate(`${id}-admin`, cleaner, 35, { appliesFrom: today });
      expect((await m.client.user.findUniqueOrThrow({ where: { id: cleaner } })).hourlyRate).toBe(35);
      const future = await updateHourlyRate(`${id}-admin`, cleaner, 45, { appliesFrom: addDaysToKey(today, 7) });
      const history = await listPayRateHistory(cleaner);
      expect(history.entries.map((entry) => [entry.hourlyRate, entry.state])).toEqual([[45, "FUTURE"], [35, "CURRENT"], [30, "PAST"]]);
      const current = history.entries.find((entry) => entry.state === "CURRENT")!;
      await expect(removeFuturePayRate(`${id}-admin`, cleaner, current.id)).rejects.toThrow(/already started/);
      await removeFuturePayRate(`${id}-admin`, cleaner, future.entryId!);
      const removed = await m.client.userPayRate.findUniqueOrThrow({ where: { id: future.entryId! } });
      expect(removed.removedAt).not.toBeNull();
      expect((await loadPayRateBook([cleaner])).rateFor(cleaner, dayDate(addDaysToKey(today, 8)), 35)).toBe(35);
    });
  });

  describe("cancel job", () => {
    it("cancels an unstarted job for an operations manager, releases the cleaner, and restores it", async () => {
      const jobId = await job("unstarted", "ASSIGNED");
      await assign(jobId);
      const result = await cancelJob(jobId, { reason: "Owner cancelled the booking" }, ops());
      expect(result.released.map((row) => row.userId)).toEqual([`${id}-cleaner`]);
      const cancelled = await m.client.job.findUniqueOrThrow({ where: { id: jobId }, include: { assignments: true } });
      expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Owner cancelled the booking", cancelledFromStatus: "ASSIGNED", cancelledById: `${id}-ops` });
      expect(cancelled.assignments[0].removedAt).not.toBeNull();
      expect(await m.client.auditLog.count({ where: { jobId, action: "JOB_CANCELLED" } })).toBe(1);
      await expect(cancelJob(jobId, { reason: "again" }, admin())).rejects.toThrow(/already cancelled/);

      expect(await restoreSlotConflicts(jobId)).toEqual([]);
      const restored = await restoreJob(jobId, ops());
      expect(restored).toMatchObject({ status: "ASSIGNED", restoredUserIds: [`${id}-cleaner`] });
      const back = await m.client.job.findUniqueOrThrow({ where: { id: jobId }, include: { assignments: true } });
      expect(back.status).toBe("ASSIGNED");
      expect(back.assignments[0]).toMatchObject({ removedAt: null, isPrimary: true });
    });

    it("requires a reason, ADMIN for a started job, a stopped clock, and refuses invoiced or paid work", async () => {
      const started = await job("started", "IN_PROGRESS");
      await assign(started);
      await expect(cancelJob(started, { reason: "  " }, admin())).rejects.toThrow(/reason/);
      await expect(cancelJob(started, { reason: "Guest stayed on" }, ops())).rejects.toMatchObject({ status: 403 });
      const log = await m.client.timeLog.create({ data: { jobId: started, userId: `${id}-cleaner`, startedAt: new Date(Date.now() - 3_600_000) } });
      await expect(cancelJob(started, { reason: "Guest stayed on" }, admin())).rejects.toThrow(/clock is running/);
      await m.client.timeLog.update({ where: { id: log.id }, data: { stoppedAt: new Date(), durationM: 60 } });
      await cancelJob(started, { reason: "Guest stayed on" }, admin());
      // Time evidence is kept exactly as it was.
      expect(await m.client.timeLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ durationM: 60 });
      // A job that had started is not restored.
      await expect(restoreJob(started, admin())).rejects.toThrow(/had started/);

      const invoiced = await job("onDraft", "COMPLETED");
      await m.client.clientInvoice.create({ data: { id: `${id}-inv`, clientId: id, invoiceNumber: `${id}-inv`, status: "DRAFT", subtotal: 100, totalAmount: 100, gstEnabled: false,
        lines: { create: [{ jobId: invoiced, description: "Clean", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" }] } } });
      await expect(cancelJob(invoiced, { reason: "Duplicate" }, admin())).rejects.toThrow(new RegExp(`invoice ${id}-inv`));
      await m.client.clientInvoice.update({ where: { id: `${id}-inv` }, data: { status: "VOID" } });
      await cancelJob(invoiced, { reason: "Duplicate" }, admin());

      const run = await m.client.payrollRun.create({ data: { periodStart: dayDate(today), periodEnd: dayDate(today), createdByUserId: `${id}-admin` } as never });
      const paid = await job("paid", "COMPLETED", today, { payrollRunId: run.id });
      await expect(cancelJob(paid, { reason: "Duplicate" }, admin())).rejects.toThrow(/payroll run/);
      await expect(cancelJob(await job("inv", "INVOICED"), { reason: "x y z" }, admin())).rejects.toBeInstanceOf(JobCancelError);
    });

    it("is never billed (even with time logged), left out of the Jobs list default and the calendar unless asked", async () => {
      const day = addDaysToKey(today, 1);
      const kept = await job("kept", "COMPLETED", day, { completedAt: dayDate(day) });
      const gone = await job("gone", "ASSIGNED", day);
      await m.client.timeLog.create({ data: { jobId: gone, userId: `${id}-cleaner`, startedAt: dayDate(day), stoppedAt: dayDate(day), durationM: 30 } });
      await cancelJob(gone, { reason: "Booking cancelled" }, admin());

      const invoice = await generateClientInvoice({ clientId: id, periodStart: dayDate(addDaysToKey(today, -2)), periodEnd: dayDate(addDaysToKey(today, 5)), periodBasis: "SCHEDULED" } as never);
      const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: (invoice as { id: string }).id }, select: { jobId: true } });
      expect(lines.map((line) => line.jobId)).toEqual([kept]);

      const where = buildJobsWhere({ status: null, statusGroup: null, jobType: null, propertyId: id, clientId: null, cleanerId: null, date: null, dateFrom: null, dateTo: null, search: "", invoiced: null, role: "ADMIN" as never, userId: `${id}-admin` });
      expect((await m.client.job.findMany({ where: where as never, select: { id: true } })).map((row) => row.id)).toEqual([kept]);
      const asked = buildJobsWhere({ status: ["CANCELLED"] as never, statusGroup: null, jobType: null, propertyId: id, clientId: null, cleanerId: null, date: null, dateFrom: null, dateTo: null, search: "", invoiced: null, role: "ADMIN" as never, userId: `${id}-admin` });
      expect((await m.client.job.findMany({ where: asked as never, select: { id: true } })).map((row) => row.id)).toEqual([gone]);

      const filters = { rowsMode: "cleaners" as const, statuses: null, clientId: id, unassignedOnly: false, includeLaundry: false };
      const calendar = await loadCalendarRange({ start: day, end: day }, filters);
      expect(calendar.jobs.map((entry) => entry.id)).toEqual([kept]);
      expect(calendar.summary.statusCounts.CANCELLED).toBe(1);
      const cancelledView = await loadCalendarRange({ start: day, end: day }, { ...filters, statuses: ["CANCELLED"] as never });
      expect(cancelledView.jobs.map((entry) => entry.id)).toEqual([gone]);
    });
  });

  describe("leave", () => {
    it("blocks suggestions with the reason and needs the override to assign", async () => {
      const cleaner = `${id}-cleaner`;
      const day = addDaysToKey(today, 5);
      const leave = await createLeave(`${id}-ops`, cleaner, { startDate: day, endDate: addDaysToKey(day, 2), kind: "LEAVE" });
      await expect(createLeave(`${id}-ops`, cleaner, { startDate: addDaysToKey(day, 1), endDate: addDaysToKey(day, 1), kind: "DAY_OFF" })).rejects.toThrow(/overlaps/);
      const jobId = await job("leave", "UNASSIGNED", day);
      const suggestions = await loadCleanerSuggestions(jobId);
      expect(suggestions.kind).toBe("ok");
      const mine = suggestions.kind === "ok" ? suggestions.suggestions.find((row) => row.cleanerId === cleaner) : null;
      expect(mine).toMatchObject({ assignable: false, blocker: { kind: "leave" } });
      expect(mine?.blocker?.reason).toMatch(/^On leave /);
      const conflicts = await assignmentLeaveConflicts([cleaner], dayDate(day), [{ id: cleaner, name: "Wave Cleaner", email: null }]);
      expect(conflicts).toHaveLength(1);
      await removeLeave(`${id}-ops`, cleaner, leave.id);
      expect(await assignmentLeaveConflicts([cleaner], dayDate(day), [])).toEqual([]);
    });
  });

  describe("QA template copy", () => {
    it("reads a past inspection with the template it was filled in on after the template changes", async () => {
      const original = { sections: [{ id: "s", title: "Kitchen", fields: [{ id: "f1", label: "Bench", type: "rating" }] }] };
      const template = await m.client.qaFormTemplate.create({ data: { name: `${id} QA`, serviceType: "GENERAL_CLEAN", schema: original } });
      const jobId = await job("qa", "COMPLETED");
      const copy = await exactTemplateCopy(m.client, template);
      await m.client.qaFormSubmission.create({ data: { jobId, templateId: template.id, submittedById: `${id}-admin`, data: {}, score: 90, passed: true,
        templateSnapshot: copy.templateSnapshot as never, templateSnapshotName: copy.templateSnapshotName, templateSnapshotSource: copy.templateSnapshotSource, templateRevision: copy.templateRevision } });
      await m.client.qaFormTemplate.update({ where: { id: template.id }, data: { schema: { sections: [{ id: "s", title: "Renamed", fields: [] }] } } });
      const stored = await m.client.qaFormSubmission.findFirstOrThrow({ where: { jobId }, include: { template: true } });
      expect(stored.templateSnapshotSource).toBe("EXACT");
      expect(inspectionTemplateSchema(stored)).toEqual(original);
      expect(stored.template.schema).not.toEqual(original);
    });
  });
});
