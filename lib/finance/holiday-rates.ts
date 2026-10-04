import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeClientCharge } from "./job-money";
import { DEFAULT_HOLIDAY_POLICY, applyHolidayMultiplier, holidayCalendarSchema, holidayFraction, holidayPolicySchema, multiplier, resolveHolidayMultipliers, type HolidayCalendar, type HolidayPolicy } from "./holiday-policy";
import { NSW_HOLIDAY_SOURCE, parseNswHolidayCalendar } from "./holiday-calendar";
import bundledCalendar from "./nsw-holiday-cache.json";

type Tx = Prisma.TransactionClient;
const POLICY = "holiday_rates_v1:policy", CALENDAR = "holiday_rates_v1:calendar:";
const snapshotKey = (jobId: string) => `holiday_rates_v1:job:${jobId}`;
const json = (value: unknown) => value as Prisma.InputJsonValue;
function digest(value: unknown): string {
  const normalize = (input: any): any => Array.isArray(input) ? input.map(normalize) : input && typeof input === "object" ? Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])])) : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
const money = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
async function admin(tx: Tx, id: string) {
  const user = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive || user.role !== "ADMIN" && !user.extraRoles.some(row => row.role === "ADMIN")) throw new Error("FORBIDDEN");
}
async function save(tx: Tx, key: string, value: unknown) { await tx.appSetting.upsert({ where: { key }, create: { key, value: json(value) }, update: { value: json(value) } }); }
async function audit(tx: Tx, userId: string, action: string, entityId: string, before: unknown, after: unknown) {
  await tx.auditLog.create({ data: { userId, action, entity: "HolidayRates", entityId, before: json(before), after: json(after) } });
}
export async function getHolidayPolicy(tx: Tx = db): Promise<HolidayPolicy> {
  const row = await tx.appSetting.findUnique({ where: { key: POLICY } });
  if (row) return holidayPolicySchema.parse(row.value);
  const settings = await getAppSettings();
  return { ...DEFAULT_HOLIDAY_POLICY, timezone: settings.timezone || DEFAULT_HOLIDAY_POLICY.timezone };
}
export async function getHolidayCalendar(jurisdiction: string, tx: Tx = db): Promise<HolidayCalendar> {
  const row = await tx.appSetting.findUnique({ where: { key: CALENDAR + jurisdiction } });
  if (!row && jurisdiction !== bundledCalendar.jurisdiction) throw new Error("No verified calendar for this jurisdiction. Import an authoritative calendar before applying rates.");
  return holidayCalendarSchema.parse(row?.value ?? bundledCalendar);
}
export async function saveHolidayPolicy(userId: string, input: unknown, reason: string) {
  const policy = holidayPolicySchema.parse(input); reason = z.string().trim().min(1).max(2000).parse(reason);
  return db.$transaction(async tx => {
    await admin(tx, userId); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${POLICY}))`;
    const before = await getHolidayPolicy(tx);
    if (policy.version !== before.version) throw new Error("CONFLICT: policy changed. Reload before saving.");
    const after = { ...policy, version: before.version + 1 };
    await save(tx, POLICY, after); await audit(tx, userId, "HOLIDAY_POLICY_UPDATED", POLICY, before, { policy: after, reason });
    return after;
  });
}
export async function saveHolidayCalendar(userId: string, raw: unknown, reason: string) {
  const calendar = holidayCalendarSchema.parse(raw);
  calendar.version = digest({ jurisdiction: calendar.jurisdiction, years: calendar.years, entries: calendar.entries, sourceUrl: calendar.sourceUrl });
  reason = z.string().trim().min(1).max(2000).parse(reason);
  if (Date.parse(calendar.verifiedAt) > Date.now()) throw new Error("Calendar verification cannot be in the future.");
  return db.$transaction(async tx => {
    await admin(tx, userId); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${POLICY}))`;
    const previous = await tx.appSetting.findUnique({ where: { key: CALENDAR + calendar.jurisdiction } });
    await save(tx, CALENDAR + calendar.jurisdiction, calendar);
    await audit(tx, userId, "HOLIDAY_CALENDAR_UPDATED", calendar.jurisdiction, previous?.value ?? {}, { calendar, reason });
    return calendar;
  });
}
export async function refreshNswHolidayCalendar(userId: string) {
  await admin(db, userId);
  const response = await fetch(NSW_HOLIDAY_SOURCE, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Official calendar unavailable; existing cache was not changed.");
  const html = await response.text(); if (html.length > 2_000_000) throw new Error("Unexpected calendar response size.");
  return saveHolidayCalendar(userId, parseNswHolidayCalendar(html, new Date().toISOString()), "Refreshed from NSW Government statewide holiday table; local holidays require separately verified area records.");
}
export const holidayJobInput = z.object({
  jobId: z.string().min(1), expectedUpdatedAt: z.string().datetime(), policyVersion: z.number().int().nonnegative(), calendarVersion: z.string().min(1), requestId: z.string().uuid(), reason: z.string().trim().min(1).max(2000),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), dayOverride: z.enum(["AUTO", "HOLIDAY", "ORDINARY"]).default("AUTO"), clientMultiplier: multiplier.optional(), cleanerMultipliers: z.record(multiplier).default({}), clientFinalPrice: z.number().finite().positive().optional(),
}).strict();
type JobInput = z.infer<typeof holidayJobInput>;
const jobInclude = { property: { include: { client: true } }, assignments: { where: { removedAt: null }, include: { user: { select: { id: true, name: true, hourlyRate: true } } } }, timeLogs: true } satisfies Prisma.JobInclude;
type RateJob = Prisma.JobGetPayload<{ include: typeof jobInclude }>;
type Snapshot = { payoutFingerprint: string; fingerprint: string; reviewHash: string; id: string; state: "APPLIED" | "REVERTED"; jobId: string; requestId: string; input: JobInput; policy: HolidayPolicy; calendar: HolidayCalendar; scheduledDay: string; propertyId: string; jobType: string; clientId: string; area: string; clientFraction: number; clientBasis: string; client: { before: number | null; after: number | null; base: number | null; multiplier: number; source: string }; cleaners: Array<{ id: string; name: string | null; before: number | null; after: number | null; base: number | null; multiplier: number; fraction: number; source: string }>; holidays: string[]; recordedAt: string; actorId: string };
function intervals(job: RateJob, cleanerId?: string) {
  const logs = job.timeLogs.filter(row => !cleanerId || row.userId === cleanerId);
  if (logs.some(row => !row.stoppedAt)) throw new Error("Finish open work timers before reviewing holiday rates.");
  return logs.map(row => ({ start: row.startedAt.toISOString(), end: row.stoppedAt!.toISOString() }));
}
function fractions(job: RateJob, policy: HolidayPolicy, calendar: HolidayCalendar, input: Pick<JobInput, "dayOverride">, area: string, cleanerId?: string) {
  return holidayFraction({ calendar, timezone: policy.timezone, area, scheduledDay: job.scheduledDate.toISOString().slice(0, 10), intervals: intervals(job, cleanerId), override: input.dayOverride });
}
async function assertUnclaimed(tx: Tx, job: RateJob) {
  if (job.payrollRunId || job.cleanerPaidAt) throw new Error("Job is already claimed or paid. Historical billing/pay cannot be changed here.");
  if (await tx.clientInvoiceLine.findFirst({ where: { jobId: job.id, invoice: { status: { not: "VOID" } } }, select: { id: true } })) throw new Error("Job is on a client invoice. Existing invoice amounts are immutable here.");
  const claimed = await tx.cleanerInvoiceSubmission.findFirst({ where: { status: { notIn: ["VOID", "CHANGES_REQUESTED"] }, lineData: { path: ["jobIds"], array_contains: [job.id] } }, select: { id: true } });
  if (claimed) throw new Error("Job is already claimed on a cleaner invoice.");
}
async function lockJob(tx: Tx, jobId: string) {
  const initial = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-invoice:${initial.property.clientId}`}))`;
  for (const id of initial.assignments.map(row => row.userId).sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR UPDATE`;
  return tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
}
async function calculate(tx: Tx, job: RateJob, input: JobInput, actorId: string): Promise<Snapshot> {
  const policy = await getHolidayPolicy(tx), calendar = await getHolidayCalendar(policy.jurisdiction, tx);
  if (input.policyVersion !== policy.version || input.calendarVersion !== calendar.version) throw new Error("CONFLICT: policy or calendar changed. Review again.");
  if (input.dayOverride === "AUTO" && (Date.now() - Date.parse(calendar.verifiedAt) > policy.maxCalendarAgeDays * 86400000 || Date.parse(calendar.verifiedAt) > Date.now())) throw new Error("Calendar verification is stale or future-dated. Refresh before applying rates.");
  if (job.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new Error("CONFLICT: job changed. Review again.");
  if (job.cleanSkipStatus === "SKIPPED") throw new Error("Skipped jobs cannot receive holiday rates.");
  const meta = parseJobInternalNotes(job.internalNotes), settings = await getAppSettings();
  const resolved = resolveHolidayMultipliers(policy, { clientId: job.property.clientId, clientName: job.property.client.name, propertyId: job.propertyId, clientOverride: input.clientMultiplier });
  const clientFraction = fractions(job, policy, calendar, input, resolved.area);
  const rates = await tx.propertyClientRate.findMany({ where: { propertyId: job.propertyId, jobType: job.jobType, isActive: true } });
  const priceBook = await tx.priceBook.findMany({ where: { jobType: job.jobType } });
  const charge = computeClientCharge(job, { propertyRates: rates, priceBook });
  const preservedQuote = money(job.fixedPrice) !== null && input.clientFinalPrice === undefined;
  const clientMultiplier = preservedQuote ? 1 : resolved.client;
  if (charge.amount === null && clientMultiplier !== 1) throw new Error("Configure the client's normal base rate before applying a holiday multiplier.");
  const clientAfter = input.clientFinalPrice ?? (preservedQuote || clientMultiplier === 1 || clientFraction.fraction === 0 ? job.fixedPrice : applyHolidayMultiplier(charge.amount!, clientMultiplier, clientFraction.fraction));
  for (const id of Object.keys(input.cleanerMultipliers)) if (!job.assignments.some(row => row.userId === id)) throw new Error("Cleaner override must belong to a current assignment.");
  const cleaners = job.assignments.map(assignment => {
    const rate = resolveHolidayMultipliers(policy, { clientId: job.property.clientId, clientName: job.property.client.name, propertyId: job.propertyId, cleanerId: assignment.userId, cleanerOverride: input.cleanerMultipliers[assignment.userId] }).cleaner;
    const fraction = fractions(job, policy, calendar, input, resolved.area, assignment.userId).fraction;
    const base = money(assignment.payRate) ?? money(settings.cleanerJobHourlyRates?.[assignment.userId]?.[job.jobType]) ?? money(assignment.user.hourlyRate);
    const custom = typeof meta.cleanerPayouts?.[assignment.userId] === "number" || job.isRework;
    if (base === null && rate !== 1 && fraction > 0 && !custom) throw new Error(`Configure a normal pay rate for ${assignment.user.name || assignment.userId}.`);
    return { id: assignment.userId, name: assignment.user.name, before: assignment.payRate, after: custom || rate === 1 || fraction === 0 ? assignment.payRate : applyHolidayMultiplier(base!, rate, fraction), base, multiplier: custom ? 1 : rate, fraction, source: custom ? "CUSTOM_PAYOUT_PRESERVED" : "NORMAL_HOURLY_BASE" };
  });
  const snapshot: Snapshot = { payoutFingerprint: digest({ isRework: job.isRework, cleanerPayouts: meta.cleanerPayouts ?? {} }), fingerprint: digest(input), reviewHash: "", id: randomUUID(), state: "APPLIED", jobId: job.id, requestId: input.requestId, input, policy, calendar, scheduledDay: job.scheduledDate.toISOString().slice(0, 10), propertyId: job.propertyId, jobType: job.jobType, clientId: job.property.clientId, area: resolved.area, clientFraction: clientFraction.fraction, clientBasis: clientFraction.basis,
    client: { before: job.fixedPrice, after: clientAfter, base: charge.amount, multiplier: clientMultiplier, source: input.clientFinalPrice !== undefined ? "EXPLICIT_FINAL_PRICE" : preservedQuote ? "FIXED_QUOTE_PRESERVED" : charge.source }, cleaners, holidays: clientFraction.names, recordedAt: new Date().toISOString(), actorId };
  snapshot.reviewHash = digest({ payoutFingerprint: snapshot.payoutFingerprint, jobId: snapshot.jobId, scheduledDay: snapshot.scheduledDay, propertyId: snapshot.propertyId, clientId: snapshot.clientId, jobType: snapshot.jobType, policyVersion: policy.version, calendarVersion: calendar.version, area: snapshot.area, clientFraction: snapshot.clientFraction, clientBasis: snapshot.clientBasis, client: snapshot.client, cleaners: snapshot.cleaners });
  return snapshot;
}
export async function previewHolidayJob(userId: string, raw: unknown) {
  const input = holidayJobInput.parse(raw); await admin(db, userId);
  const job = await db.job.findUniqueOrThrow({ where: { id: input.jobId }, include: jobInclude });
  await assertUnclaimed(db, job);
  const previous = await db.appSetting.findUnique({ where: { key: snapshotKey(job.id) } });
  if ((previous?.value as any)?.state === "APPLIED") throw new Error("Holiday snapshot already applied. Revert and review before repricing.");
  return calculate(db, job, input, userId);
}
export async function applyHolidayJob(userId: string, raw: unknown) {
  const input = holidayJobInput.parse(raw);
  return db.$transaction(async tx => {
    await admin(tx, userId); const job = await lockJob(tx, input.jobId);
    const previous = (await tx.appSetting.findUnique({ where: { key: snapshotKey(job.id) } }))?.value as unknown as Snapshot | undefined;
    if (previous?.state === "APPLIED") {
      if (previous.requestId === input.requestId && previous.fingerprint === digest(input)) return previous;
      throw new Error("Holiday snapshot already applied. Revert and review before repricing.");
    }
    await assertUnclaimed(tx, job); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${POLICY}))`;
    const snapshot = await calculate(tx, job, input, userId);
    if (!input.reviewHash || input.reviewHash !== snapshot.reviewHash) throw new Error("CONFLICT: preview the current normal rates before applying this job snapshot.");
    await tx.job.update({ where: { id: job.id }, data: { fixedPrice: snapshot.client.after } });
    for (const cleaner of snapshot.cleaners) await tx.jobAssignment.update({ where: { jobId_userId: { jobId: job.id, userId: cleaner.id } }, data: { payRate: cleaner.after } });
    await save(tx, snapshotKey(job.id), snapshot); await audit(tx, userId, "HOLIDAY_RATES_APPLIED", job.id, previous ?? {}, snapshot);
    return snapshot;
  });
}
export async function revertHolidayJob(userId: string, jobId: string, snapshotId: string, reason: string) {
  reason = z.string().trim().min(1).max(2000).parse(reason);
  return db.$transaction(async tx => {
    await admin(tx, userId); const job = await lockJob(tx, jobId); await assertUnclaimed(tx, job);
    const row = await tx.appSetting.findUnique({ where: { key: snapshotKey(job.id) } }); const before = row?.value as unknown as Snapshot | undefined;
    if (!before || before.id !== snapshotId || before.state !== "APPLIED") throw new Error("CONFLICT: snapshot changed or already reverted.");
    // Later explicit edits are preserved rather than overwritten by rollback.
    await tx.job.update({ where: { id: job.id }, data: { fixedPrice: job.fixedPrice === before.client.after ? before.client.before : job.fixedPrice } });
    for (const cleaner of before.cleaners) {
      const assignment = job.assignments.find(row => row.userId === cleaner.id);
      if (assignment && assignment.payRate === cleaner.after) await tx.jobAssignment.update({ where: { id: assignment.id }, data: { payRate: cleaner.before } });
    }
    const after = { ...before, state: "REVERTED", revertedAt: new Date().toISOString(), revertedBy: userId, revertReason: reason };
    await save(tx, snapshotKey(job.id), after); await audit(tx, userId, "HOLIDAY_RATES_REVERTED", job.id, before, after); return after;
  });
}
/** Claim-time gate: rescheduling/assignment changes never silently bill stale rates. */
export async function assertHolidayRateSnapshots(tx: Tx, jobIds: string[], expectedVersions?: Record<string, Date>) {
  if (!jobIds.length) return;
  for (const id of Array.from(new Set(jobIds)).sort()) await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
  const snapshots = await tx.appSetting.findMany({ where: { key: { in: jobIds.map(snapshotKey) } } });
  for (const row of snapshots) {
    const snapshot = row.value as unknown as Snapshot; if (snapshot.state !== "APPLIED") continue;
    const job = await tx.job.findUniqueOrThrow({ where: { id: snapshot.jobId }, include: jobInclude });
    const changed = snapshot.payoutFingerprint !== digest({ isRework: job.isRework, cleanerPayouts: parseJobInternalNotes(job.internalNotes).cleanerPayouts ?? {} }) || job.propertyId !== snapshot.propertyId || job.jobType !== snapshot.jobType || job.scheduledDate.toISOString().slice(0, 10) !== snapshot.scheduledDay || job.property.clientId !== snapshot.clientId || job.fixedPrice !== snapshot.client.after ||
      job.assignments.length !== snapshot.cleaners.length || snapshot.cleaners.some(cleaner => job.assignments.find(row => row.userId === cleaner.id)?.payRate !== cleaner.after) ||
      Math.abs(fractions(job, snapshot.policy, snapshot.calendar, snapshot.input, snapshot.area).fraction - snapshot.clientFraction) > 1e-8 ||
      snapshot.cleaners.some(cleaner => Math.abs(fractions(job, snapshot.policy, snapshot.calendar, snapshot.input, snapshot.area, cleaner.id).fraction - cleaner.fraction) > 1e-8);
    if (changed || expectedVersions?.[job.id] && job.updatedAt.getTime() !== expectedVersions[job.id].getTime()) throw new Error("Holiday rate snapshot changed or no longer matches the work. Review before billing or payroll.");
  }
}
export async function holidayRateWorkspace(userId: string, jobId?: string) {
  await admin(db, userId); const policy = await getHolidayPolicy();
  const [calendar, clients, properties, cleaners, job, snapshot] = await Promise.all([
    getHolidayCalendar(policy.jurisdiction).catch(() => null), db.client.findMany({ where: { isActive: true }, select: { id: true, name: true } }), db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, clientId: true } }),
    db.user.findMany({ where: { isActive: true, role: "CLEANER" }, select: { id: true, name: true } }),
    jobId ? db.job.findUnique({ where: { id: jobId }, include: jobInclude }) : null,
    jobId ? db.appSetting.findUnique({ where: { key: snapshotKey(jobId) } }) : null,
  ]);
  return { policy, calendar, clients, properties, cleaners, job: job ? { id: job.id, jobNumber: job.jobNumber, updatedAt: job.updatedAt, scheduledDate: job.scheduledDate, propertyName: job.property.name, clientName: job.property.client.name, assignments: job.assignments.map(row => ({ id: row.userId, name: row.user.name, payRate: row.payRate })) } : null, snapshot: snapshot?.value ?? null };
}
