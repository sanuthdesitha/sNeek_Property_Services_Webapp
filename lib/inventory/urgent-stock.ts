import { createHash, randomUUID } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { enqueueNotificationIntent } from "@/lib/notifications/intent-store";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { countObservationDisposition, isUrgentStockClosed, urgentStockReminderDue, urgentStockReminderSettings, urgentStockReportInput, validateUrgentStockTransition, URGENT_STOCK_STAGES } from "./urgent-stock-policy";
import { appendNeedEvent, eventFromRow, needFromRow, readNeed, readOpenNeed, writeNeed, type UrgentNeed } from "./urgent-stock-store";

export type { UrgentNeed } from "./urgent-stock-store";

// Needs and their append-only history live in UrgentStockNeed / UrgentStockEvent
// (copied from the old `urgent_stock_v1:*` JSON rows, which are kept but no
// longer read). Reminder settings and request receipts stay in AppSetting.
// No seeding, invented zero stock rows, purchases or template changes.
const PREFIX = "urgent_stock_v1:";
const SETTINGS = PREFIX + "settings";
const DEFAULTS = { enabled: false, intervalHours: 24, maxReminders: 5, beforeNextCleanHours: 24 };
type Tx = Prisma.TransactionClient;
export type StockActor = { id: string; role: Role };
export const URGENT_STOCK_ACTIVE_JOB_STATUSES = ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] as const;
const ACTIVE = URGENT_STOCK_ACTIVE_JOB_STATUSES;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** One open need per property and item; the same key the JSON store used. */
export const urgentStockPairKey = (propertyId: string, itemId: string) => PREFIX + "open:" + hash([propertyId, itemId]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
async function save(tx: Tx, key: string, value: unknown) {
  await tx.appSetting.upsert({ where: { key }, create: { key, value: json(value) }, update: { value: json(value) } });
}
function assignment(userId: string) {
  return { userId, removedAt: null, responseStatus: { in: ["PENDING", "ACCEPTED"] as ("PENDING" | "ACCEPTED")[] } };
}

async function actorRole(tx: Tx, actor: StockActor) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { isActive: true, role: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive) throw new Error("UNAUTHORIZED");
  const held = [user.role, ...user.extraRoles.map((row) => row.role)];
  if (!held.includes(actor.role) || !([Role.ADMIN, Role.CLEANER] as Role[]).includes(actor.role)) throw new Error("FORBIDDEN");
  return actor.role;
}
/** Revalidates the actor; only an administrator may use the office list. */
export async function requireUrgentStockAdmin(actor: StockActor, tx: Tx = db) {
  if (await actorRole(tx, actor) !== Role.ADMIN) throw new Error("FORBIDDEN");
}
export async function urgentStockProperties(actor: StockActor, tx: Tx = db) {
  const role = await actorRole(tx, actor);
  const cleanerScope = { jobs: { some: { status: { in: [...ACTIVE] }, cleanSkipStatus: { not: "SKIPPED" as const }, assignments: { some: assignment(actor.id) } } } };
  return tx.property.findMany({
    where: { isActive: true, inventoryEnabled: true, ...(role === Role.ADMIN ? {} : cleanerScope) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
async function scope(tx: Tx, actor: StockActor, propertyId: string) {
  if (!(await urgentStockProperties(actor, tx)).some((property) => property.id === propertyId)) throw new Error("FORBIDDEN");
}
export async function urgentStockSettings(tx: Tx = db) {
  const row = await tx.appSetting.findUnique({ where: { key: SETTINGS } });
  return urgentStockReminderSettings.parse(row?.value ?? DEFAULTS);
}
export async function setUrgentStockSettings(actor: StockActor, input: unknown) {
  const settings = urgentStockReminderSettings.parse(input);
  return db.$transaction(async (tx) => {
    if (await actorRole(tx, actor) !== Role.ADMIN) throw new Error("FORBIDDEN");
    await save(tx, SETTINGS, settings);
    await tx.auditLog.create({ data: { userId: actor.id, action: "URGENT_STOCK_REMINDERS_UPDATED", entity: "AppSetting", entityId: SETTINGS, after: json(settings) } });
    return settings;
  });
}

export type CleanDeadlineJob = { scheduledDate: Date; startTime: string | null; dueTime: string | null; internalNotes: string | null };
/** A clean's planning deadline; unknown times use the local day start. Null for drafts or bad dates. */
export function urgentStockCleanDeadline(job: CleanDeadlineJob, timezone: string): Date | null {
  if (parseJobInternalNotes(job.internalNotes).isDraft) return null;
  const time = job.startTime || job.dueTime;
  const clock = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  const date = fromZonedTime(`${job.scheduledDate.toISOString().slice(0, 10)}T${clock}:00`, timezone);
  return Number.isFinite(date.getTime()) ? date : null;
}
/** Which jobs count as "the next clean" for a property (shared with the office list). */
export function urgentStockCleanWhere(now: Date) {
  return { status: { in: [...ACTIVE] }, cleanSkipStatus: { not: "SKIPPED" as const }, scheduledDate: { gte: new Date(now.getTime() - 86400000) } };
}
export async function nextUrgentStockClean(tx: Tx, propertyId: string, now: Date, timezone: string) {
  const jobs = await tx.job.findMany({
    where: { propertyId, ...urgentStockCleanWhere(now) },
    orderBy: { scheduledDate: "asc" },
    select: { id: true, scheduledDate: true, startTime: true, dueTime: true, internalNotes: true },
    take: 100,
  });
  const deadlines = jobs.flatMap((job) => {
    const deadline = urgentStockCleanDeadline(job, timezone);
    return deadline ? [deadline] : [];
  });
  return deadlines.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

async function observation(tx: Tx, propertyId: string, itemId: string, count: number | null, observedAt: string | null, now: Date, actorId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PropertyStock" WHERE "propertyId" = ${propertyId} AND "itemId" = ${itemId} FOR UPDATE`;
  const stock = await tx.propertyStock.findUnique({ where: { propertyId_itemId: { propertyId, itemId } } });
  if (!stock) throw new Error("Item is not configured for this property.");
  const latest = await tx.stockTx.findFirst({ where: { propertyStockId: stock.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const disposition = countObservationDisposition({ count, observedAt: observedAt ? new Date(observedAt) : null, recordedAt: now, stockUpdatedAt: stock.updatedAt, latestLedgerAt: latest?.createdAt ?? null });
  if (disposition === "APPLY") {
    await tx.propertyStock.update({ where: { id: stock.id }, data: { onHand: count!, updatedAt: now } });
    await tx.stockTx.create({ data: { propertyStockId: stock.id, txType: "ADJUSTED", quantity: count! - stock.onHand, notes: `Urgent stock observation by ${actorId}; observed ${observedAt}`, createdAt: now } });
  }
  return disposition;
}
async function actorName(tx: Tx, actorId: string | null) {
  const user = actorId ? await tx.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null;
  return { stored: user?.name ?? null, label: user?.name ?? (actorId ? "Team member" : "Reminder worker") };
}
async function notify(tx: Tx, need: UrgentNeed, kind: string, nextCleanAt?: Date | null) {
  const admins = await tx.user.findMany({ where: { isActive: true, OR: [{ role: Role.ADMIN }, { extraRoles: { some: { role: Role.ADMIN } } }] }, select: { id: true } });
  if (!admins.length) return false;
  // In-app only. No email, SMS, purchase or external dispatch is performed.
  for (const admin of admins) {
    await enqueueNotificationIntent(tx, {
      version: 1,
      eventId: `${need.id}:${kind}:${need.remindersSent}`,
      eventKey: "urgent_stock.open_need",
      entity: { type: "urgent_stock", id: need.id },
      actorId: null,
      recipient: { userId: admin.id, role: Role.ADMIN, scope: { kind: "ADMIN_OPERATIONS" } },
      severity: "ACTION", category: "shopping", transport: "INBOX", jobId: null,
      subject: `Urgent stock: ${need.propertyName} — ${need.itemName}`,
      body: `${kind}. ${need.stage}. Observed count: ${need.observedCount ?? "unknown"}; requested purchase: ${need.purchaseQuantity ?? "unknown"}. ${nextCleanAt ? `Next clean planning deadline: ${nextCleanAt.toISOString()}. ` : ""}Review /urgent-stock?propertyId=${encodeURIComponent(need.propertyId)}`,
    });
  }
  return true;
}
async function receipt(tx: Tx, actor: StockActor, requestId: string, input: unknown) {
  const key = PREFIX + "receipt:" + hash([actor.id, requestId]);
  await lock(tx, key);
  const row = await tx.appSetting.findUnique({ where: { key } });
  const previous = row?.value as { fingerprint: string; result: UrgentNeed } | undefined;
  if (previous && previous.fingerprint !== hash(input)) throw new Error("CONFLICT: request ID already used for different data.");
  return { key, fingerprint: hash(input), previous: previous?.result };
}

export async function reportUrgentStock(actor: StockActor, raw: unknown) {
  const input = urgentStockReportInput.parse(raw);
  return db.$transaction(async (tx) => {
    await scope(tx, actor, input.propertyId);
    return reportWithinScope(tx, actor, input);
  });
}

/**
 * Wave B (forms): the same report, raised by a submitted job form's Stock
 * count question for the cleaner who submitted it. The cleaner's active-job
 * scope no longer holds once the job is SUBMITTED, so scope is proven by the
 * submission instead: it must exist, be submitted by this cleaner and belong
 * to a job at this property. The actor is still revalidated (active, holds the
 * cleaner role). Idempotent through the usual request receipt.
 */
export async function reportUrgentStockFromSubmission(input: { cleanerId: string; submissionId: string; report: unknown }) {
  const report = urgentStockReportInput.parse(input.report);
  const actor: StockActor = { id: input.cleanerId, role: Role.CLEANER };
  return db.$transaction(async (tx) => {
    await actorRole(tx, actor);
    const submission = await tx.formSubmission.findUnique({
      where: { id: input.submissionId },
      select: { submittedById: true, job: { select: { propertyId: true } } },
    });
    if (!submission || submission.submittedById !== input.cleanerId || submission.job?.propertyId !== report.propertyId) {
      throw new Error("FORBIDDEN");
    }
    return reportWithinScope(tx, actor, report);
  });
}

async function reportWithinScope(tx: Tx, actor: StockActor, input: z.infer<typeof urgentStockReportInput>) {
  {
    const request = await receipt(tx, actor, input.requestId, input);
    if (request.previous) return request.previous;
    const key = urgentStockPairKey(input.propertyId, input.itemId);
    await lock(tx, key);
    const previous = await readOpenNeed(tx, key);
    const property = await tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } });
    const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item?.isActive) throw new Error("Item is unavailable.");
    const now = new Date();
    const disposition = await observation(tx, input.propertyId, input.itemId, input.observedCount, input.observedAt, now, actor.id);
    const need: UrgentNeed = {
      id: previous?.id ?? randomUUID(), propertyId: input.propertyId, itemId: input.itemId, propertyName: property.name, itemName: item.name, unit: item.unit,
      stage: previous?.stage ?? "REPORTED", createdAt: previous?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(), version: (previous?.version ?? 0) + 1,
      observedCount: input.observedCount, purchaseQuantity: input.purchaseQuantity, observedAt: input.observedAt, observationDisposition: disposition, note: input.note,
      lastReminderAt: previous?.lastReminderAt ?? null, remindersSent: previous?.remindersSent ?? 0,
    };
    const name = await actorName(tx, actor.id);
    await writeNeed(tx, need, { openPairKey: key, reporter: previous ? undefined : { id: actor.id, name: name.stored } });
    await appendNeedEvent(tx, need, { actorId: actor.id, actorName: name.label, kind: previous ? "REPORT_UPDATED" : "REPORTED", fromStage: previous?.stage ?? null, detail: { ...input, observationDisposition: disposition } });
    if (!previous) await notify(tx, need, "Reported need remains open");
    await save(tx, request.key, { fingerprint: request.fingerprint, result: need });
    return need;
  }
}

export const urgentStockActionInput = z.object({
  reportId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  stage: z.enum(URGENT_STOCK_STAGES), reason: z.string().trim().min(1).max(2000),
  observedCount: z.number().finite().nonnegative().max(1_000_000).nullable(), observedAt: z.string().datetime({ offset: true }).nullable(), needResolved: z.boolean(),
}).strict();

export async function actOnUrgentStock(actor: StockActor, raw: unknown) {
  const input = urgentStockActionInput.parse(raw);
  return db.$transaction(async (tx) => {
    const initial = await readNeed(tx, input.reportId);
    if (!initial) throw new Error("NOT_FOUND");
    await scope(tx, actor, initial.propertyId);
    const request = await receipt(tx, actor, input.requestId, input);
    if (request.previous) return request.previous;
    const key = urgentStockPairKey(initial.propertyId, initial.itemId);
    await lock(tx, key);
    const current = await tx.urgentStockNeed.findUniqueOrThrow({ where: { id: input.reportId } });
    const need = needFromRow(current);
    if (need.version !== input.expectedVersion) throw new Error("CONFLICT: this report changed. Reload before recording an action.");
    const now = new Date();
    let disposition = "UNKNOWN";
    if (input.stage === "PROPERTY_CONFIRMED") disposition = await observation(tx, need.propertyId, need.itemId, input.observedCount, input.observedAt, now, actor.id);
    else if (input.observedCount !== null || input.observedAt !== null || input.needResolved) throw new Error("Only property confirmation records a new count.");
    validateUrgentStockTransition({
      from: need.stage, to: input.stage, isAdmin: actor.role === Role.ADMIN, reason: input.reason,
      confirmation: { observedCount: input.observedCount, observationApplied: disposition === "APPLY", needResolved: input.needResolved, reason: input.reason },
    });
    const confirmed = input.stage === "PROPERTY_CONFIRMED" ? { observedCount: input.observedCount, observedAt: input.observedAt, observationDisposition: disposition } : {};
    const updated: UrgentNeed = { ...need, stage: input.stage, updatedAt: now.toISOString(), version: need.version + 1, ...confirmed };
    // Closing frees the property+item slot; an open need keeps whatever slot it had.
    await writeNeed(tx, updated, { openPairKey: isUrgentStockClosed(updated.stage) ? null : current.openPairKey });
    const name = await actorName(tx, actor.id);
    await appendNeedEvent(tx, updated, { actorId: actor.id, actorName: name.label, kind: input.stage, fromStage: need.stage, detail: { ...input, observationDisposition: disposition } });
    await save(tx, request.key, { fingerprint: request.fingerprint, result: updated });
    return updated;
  });
}

export async function listUrgentStock(actor: StockActor, propertyId?: string, reportId?: string) {
  const properties = await urgentStockProperties(actor);
  if (!propertyId) return { properties, items: [], reports: [], events: [], settings: actor.role === Role.ADMIN ? await urgentStockSettings() : null };
  if (!properties.some((property) => property.id === propertyId)) throw new Error("FORBIDDEN");
  const [items, rows, events] = await Promise.all([
    db.propertyStock.findMany({ where: { propertyId, item: { isActive: true } }, select: { itemId: true, item: { select: { name: true, unit: true } } }, orderBy: { item: { name: "asc" } } }),
    db.urgentStockNeed.findMany({ where: { propertyId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
    reportId ? db.urgentStockEvent.findMany({ where: { needId: reportId, propertyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : Promise.resolve([]),
  ]);
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const nextCleanAt = await nextUrgentStockClean(db, propertyId, new Date(), timezone);
  return { properties, items, reports: rows.map(needFromRow), events: events.map(eventFromRow), nextCleanAt: nextCleanAt?.toISOString() ?? null, settings: actor.role === Role.ADMIN ? await urgentStockSettings() : null };
}

export async function dispatchUrgentStockReminders(now = new Date()) {
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const open = await db.urgentStockNeed.findMany({ where: { openPairKey: { not: null } }, select: { id: true, openPairKey: true } });
  let sent = 0;
  for (const row of open) {
    sent += await db.$transaction(async (tx) => {
      await lock(tx, row.openPairKey!);
      const current = await tx.urgentStockNeed.findUnique({ where: { id: row.id } });
      if (!current?.openPairKey) return 0;
      const need = needFromRow(current);
      const nextCleanAt = await nextUrgentStockClean(tx, need.propertyId, now, timezone);
      const due = urgentStockReminderDue({ settings: await urgentStockSettings(tx), stage: need.stage, now, createdAt: new Date(need.createdAt), lastReminderAt: need.lastReminderAt ? new Date(need.lastReminderAt) : null, remindersSent: need.remindersSent, nextCleanAt });
      if (!due) return 0;
      if (!await notify(tx, need, "Unresolved stock reminder", nextCleanAt)) return 0;
      const updated: UrgentNeed = { ...need, updatedAt: now.toISOString(), lastReminderAt: now.toISOString(), remindersSent: need.remindersSent + 1 };
      await writeNeed(tx, updated, { openPairKey: current.openPairKey });
      await appendNeedEvent(tx, updated, { actorId: null, actorName: "Reminder worker", kind: "REMINDER", fromStage: need.stage, detail: { nextCleanAt: nextCleanAt?.toISOString() ?? null, number: updated.remindersSent } });
      return 1;
    });
  }
  return { sent };
}
