// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", cleanerJobHourlyRates: {} }) }));
import { DEFAULT_HOLIDAY_POLICY } from "@/lib/finance/holiday-policy";
import { applyHolidayJob as applyRaw, getHolidayCalendar, refreshNswHolidayCalendar, previewHolidayJob as preview, revertHolidayJob as revert, saveHolidayCalendar, saveHolidayPolicy, assertHolidayRateSnapshots as guard } from "@/lib/finance/holiday-rates";
import { computeCleanerPay, computeClientCharge } from "@/lib/finance/job-money";
const url = process.env.SNEEK_TEST_DATABASE_URL;
const [adminId, cleanerId, clientId, propertyId, jobId] = Array.from({ length: 5 }, () => randomUUID());
const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const calendar = { jurisdiction: "AU-NSW", version: "fixture-calendar", sourceUrl: "https://www.nsw.gov.au/about-nsw/public-holidays", verifiedAt: new Date().toISOString(), years: [Number(day.slice(0, 4))], entries: [{ date: day, name: "Fixture declared holiday", kind: "STATEWIDE", startMinute: 0, endMinute: 1440 }] };
async function input(extra = {}) { const job = await m.client.job.findUniqueOrThrow({ where: { id: jobId } }); return { jobId, expectedUpdatedAt: job.updatedAt.toISOString(), policyVersion: 0, calendarVersion: (await getHolidayCalendar("AU-NSW")).version, requestId: randomUUID(), reason: "Reviewed owner fixture rates", dayOverride: "AUTO", cleanerMultipliers: {}, ...extra }; }
async function apply(id: string, raw: any) { const reviewed = await preview(id, raw); return applyRaw(id, { ...raw, reviewHash: reviewed.reviewHash }); }
describe.skipIf(!url)("holiday rate snapshots with real transactions", () => {
 beforeAll(async () => {
  if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback database required");
  m.client = new PrismaClient({ datasources: { db: { url } } });
  await m.client.user.createMany({ data: [{ id: adminId, email: `${adminId}@example.invalid`, role: "ADMIN" }, { id: cleanerId, name: "Fixture cleaner", email: `${cleanerId}@example.invalid`, role: "CLEANER", hourlyRate: 60 }] });
  await m.client.client.create({ data: { id: clientId, name: "Jackson" } });
  await m.client.property.create({ data: { id: propertyId, clientId, name: "Holiday fixture", address: "Fixture", suburb: "Fixture" } });
  await m.client.propertyClientRate.create({ data: { propertyId, jobType: "AIRBNB_TURNOVER", baseCharge: 100 } });
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date(day), estimatedHours: 2, status: "ASSIGNED", assignments: { create: { userId: cleanerId, payRate: 40, responseStatus: "ACCEPTED" } } } });
 });
 beforeEach(async () => {
  vi.unstubAllGlobals();
  await m.client.propertyClientRate.updateMany({ where: { propertyId }, data: { baseCharge: 100 } });
  await m.client.appSetting.deleteMany({ where: { key: { startsWith: "holiday_rates_v1:" } } });
  await m.client.clientInvoice.deleteMany({ where: { clientId } });
  await m.client.cleanerInvoiceSubmission.deleteMany({ where: { cleanerId } });
  await m.client.timeLog.deleteMany({ where: { jobId } });
  await m.client.job.update({ where: { id: jobId }, data: { fixedPrice: null, internalNotes: null, scheduledDate: new Date(day), payrollRunId: null, cleanerPaidAt: null } });
  await m.client.jobAssignment.updateMany({ where: { jobId }, data: { payRate: 40 } });
  await saveHolidayCalendar(adminId, calendar, "Disposable fixture declaration");
 });
 afterAll(async () => {
  await m.client.appSetting.deleteMany({ where: { key: { startsWith: "holiday_rates_v1:" } } });
  await m.client.auditLog.deleteMany({ where: { userId: adminId } });
  await m.client.clientInvoice.deleteMany({ where: { clientId } }); await m.client.cleanerInvoiceSubmission.deleteMany({ where: { cleanerId } });
  await m.client.timeLog.deleteMany({ where: { jobId } }); await m.client.jobAssignment.deleteMany({ where: { jobId } }); await m.client.job.delete({ where: { id: jobId } });
  await m.client.propertyClientRate.deleteMany({ where: { propertyId } }); await m.client.property.delete({ where: { id: propertyId } }); await m.client.client.delete({ where: { id: clientId } });
  await m.client.user.deleteMany({ where: { id: { in: [adminId, cleanerId] } } }); await m.client.$disconnect();
 });
 it("previews without mutation, uses each normal base independently, and applies only once under concurrent retry", async () => {
  const request = await input(); const viewed = await preview(adminId, request);
  expect(viewed.client).toMatchObject({ base: 100, after: 150, multiplier: 1.5 }); expect(viewed.cleaners[0]).toMatchObject({ base: 40, after: 50, multiplier: 1.25 });
  expect((await m.client.job.findUnique({ where: { id: jobId } })).fixedPrice).toBeNull();
  const [first, retry] = await Promise.all([applyRaw(adminId, { ...request, reviewHash: viewed.reviewHash }), applyRaw(adminId, { ...request, reviewHash: viewed.reviewHash })]); expect(first.id).toBe(retry.id);
  expect(await m.client.auditLog.count({ where: { userId: adminId, action: "HOLIDAY_RATES_APPLIED", entityId: jobId } })).toBeGreaterThan(0);
  const job = await m.client.job.findUnique({ where: { id: jobId }, include: { assignments: true } });
  expect(computeClientCharge(job, {}).amount).toBe(150);
  expect(computeCleanerPay(job, { payRate: job.assignments[0].payRate }, {}, { cleanerId, activeAssignmentCount: 1, approvedAdjustments: -5, transportAllowance: 10 }).total).toBe(105);
  await expect(apply(adminId, await input())).rejects.toThrow("already applied");
 });
 it("preserves fixed quotes and custom payouts; explicit final price is distinct", async () => {
  await m.client.job.update({ where: { id: jobId }, data: { fixedPrice: 180, internalNotes: JSON.stringify({ version: 1, cleanerPayouts: { [cleanerId]: 95 }, internalNoteText: "Keep job notes" }) } });
  const view = await preview(adminId, await input()); expect(view.client).toMatchObject({ after: 180, source: "FIXED_QUOTE_PRESERVED" }); expect(view.cleaners[0]).toMatchObject({ after: 40, source: "CUSTOM_PAYOUT_PRESERVED" });
  const applied = await apply(adminId, await input({ clientFinalPrice: 190 })); expect(applied.client.source).toBe("EXPLICIT_FINAL_PRICE");
  expect((await m.client.job.findUnique({ where: { id: jobId } })).internalNotes).toContain("Keep job notes");
 });
 it("requires fresh calendar and job versions; cleaner cannot configure or apply", async () => {
  await expect(apply(cleanerId, await input())).rejects.toThrow("FORBIDDEN");
  await expect(apply(adminId, await input({ expectedUpdatedAt: "2000-01-01T00:00:00Z" }))).rejects.toThrow("CONFLICT");
  await saveHolidayCalendar(adminId, { ...calendar, verifiedAt: "2000-01-01T00:00:00Z" }, "Fixture stale cache");
  await expect(apply(adminId, await input())).rejects.toThrow("stale");
  expect((await apply(adminId, await input({ dayOverride: "ORDINARY" }))).client.after).toBeNull();
 });
 it("snapshots policy/calendar versions, guards rescheduling and reverts without compounding or losing notes", async () => {
  const snap = await apply(adminId, await input());
  await saveHolidayPolicy(adminId, { ...DEFAULT_HOLIDAY_POLICY, clientNames: { Jackson: 2 } }, "Future policy change");
  await m.client.$transaction((tx: any) => guard(tx, [jobId]));
  await m.client.job.update({ where: { id: jobId }, data: { scheduledDate: new Date(Date.parse(day) + 86400000) } });
  await expect(m.client.$transaction((tx: any) => guard(tx, [jobId]))).rejects.toThrow("no longer matches");
  await revert(adminId, jobId, snap.id, "Rescheduled ordinary-day work");
  expect((await m.client.job.findUnique({ where: { id: jobId } })).fixedPrice).toBeNull();
  expect((await m.client.jobAssignment.findFirst({ where: { jobId } })).payRate).toBe(40);
 });
 it.each(["SENT", "PAID"])("never changes an existing %s client invoice", async status => {
  const invoice = await m.client.clientInvoice.create({ data: { clientId, invoiceNumber: randomUUID(), status, subtotal: 100, gstAmount: 10, totalAmount: 110, lines: { create: { jobId, description: "Original", category: "CLEANING", unitPrice: 100, lineTotal: 100 } } } });
  await expect(apply(adminId, await input())).rejects.toThrow("client invoice");
  expect((await m.client.clientInvoice.findUnique({ where: { id: invoice.id }, include: { lines: true } })).totalAmount).toBe(110);
  expect((await m.client.job.findUnique({ where: { id: jobId } })).fixedPrice).toBeNull();
 });
 it("refuses paid or cleaner-invoiced work and never reverts a claimed snapshot", async () => {
  const snap = await apply(adminId, await input());
  await m.client.job.update({ where: { id: jobId }, data: { cleanerPaidAt: new Date() } });
  await expect(revert(adminId, jobId, snap.id, "Attempted paid change")).rejects.toThrow("claimed or paid");
  expect((await m.client.jobAssignment.findFirst({ where: { jobId } })).payRate).toBe(50);
 });
 it("rejects base rate changes after preview and changed payload retries", async () => {
  const request = await input(); const reviewed = await preview(adminId, request);
  await m.client.propertyClientRate.updateMany({ where: { propertyId }, data: { baseCharge: 120 } });
  await expect(applyRaw(adminId, { ...request, reviewHash: reviewed.reviewHash })).rejects.toThrow("CONFLICT");
  const fresh = await preview(adminId, request);
  await applyRaw(adminId, { ...request, reviewHash: fresh.reviewHash });
  await expect(applyRaw(adminId, { ...request, reviewHash: fresh.reviewHash, reason: "Different request body" })).rejects.toThrow("already applied");
 });
 it("detects custom payout drift before claims and preserves later manual edits on revert", async () => {
  const snap = await apply(adminId, await input({ clientMultiplier: 1.8, cleanerMultipliers: { [cleanerId]: 1.4 } }));
  expect(snap.client.after).toBe(180); expect(snap.cleaners[0].after).toBe(56);
  await m.client.job.update({ where: { id: jobId }, data: { internalNotes: JSON.stringify({ version: 1, cleanerPayouts: { [cleanerId]: 99 } }) } });
  await expect(m.client.$transaction((tx: any) => guard(tx, [jobId]))).rejects.toThrow("no longer matches");
  await m.client.job.update({ where: { id: jobId }, data: { fixedPrice: 199 } });
  await revert(adminId, jobId, snap.id, "Keep new manual quote");
  expect((await m.client.job.findUnique({ where: { id: jobId } })).fixedPrice).toBe(199);
 });
 it("keeps the verified cache intact when official refresh fails or the table changes", async () => {
  const before = await getHolidayCalendar("AU-NSW");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  await expect(refreshNswHolidayCalendar(adminId)).rejects.toThrow("existing cache was not changed");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "<html>Unexpected provider page</html>" }));
  await expect(refreshNswHolidayCalendar(adminId)).rejects.toThrow("Could not identify");
  expect(await getHolidayCalendar("AU-NSW")).toEqual(before);
  const changed = await saveHolidayCalendar(adminId, { ...calendar, entries: [{ ...calendar.entries[0], name: "Corrected declaration" }] }, "Reviewed correction");
  expect(changed.version).not.toBe(before.version);
 });

 it("rejects cleaner invoice claims and recomputes actual work crossing the holiday boundary", async () => {
  await m.client.cleanerInvoiceSubmission.create({ data: { cleanerId, periodStart: new Date(day), periodEnd: new Date(day), status: "SUBMITTED", lineData: { jobIds: [jobId] } } });
  await expect(apply(adminId, await input())).rejects.toThrow("cleaner invoice");
  await m.client.cleanerInvoiceSubmission.deleteMany({ where: { cleanerId } });
  const snap = await apply(adminId, await input());
  // UTC midday next day is outside this Sydney declaration, regardless of DST.
  await m.client.timeLog.create({ data: { jobId, userId: cleanerId, startedAt: new Date(Date.parse(day) + 36 * 3600000), stoppedAt: new Date(Date.parse(day) + 37 * 3600000) } });
  await expect(m.client.$transaction((tx: any) => guard(tx, [jobId]))).rejects.toThrow("no longer matches");
  await revert(adminId, jobId, snap.id, "Review actual ordinary-day work");
  expect((await preview(adminId, await input())).clientFraction).toBe(0);
 });

});
