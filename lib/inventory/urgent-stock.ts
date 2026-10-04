import { createHash, randomUUID } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { countObservationDisposition, isUrgentStockClosed, urgentStockReminderDue, urgentStockReminderSettings, urgentStockReportInput, validateUrgentStockTransition, URGENT_STOCK_STAGES, type UrgentStockStage } from "./urgent-stock-policy";

// Versioned records and append-only events use existing transactional JSON
// storage. No seeding, invented zero stock rows, purchases or template changes.
const PREFIX = "urgent_stock_v1:";
const SETTINGS = PREFIX + "settings";
const DEFAULTS = { enabled: false, intervalHours: 24, maxReminders: 5, beforeNextCleanHours: 24 };
type Tx = Prisma.TransactionClient;
export type StockActor = { id: string; role: Role };
export type UrgentNeed = {
  id: string; propertyId: string; itemId: string; propertyName: string; itemName: string; unit: string;
  stage: UrgentStockStage; createdAt: string; updatedAt: string; version: number;
  observedCount: number | null; purchaseQuantity: number | null; observedAt: string | null;
  observationDisposition: string; note: string; lastReminderAt: string | null; remindersSent: number;
};
const ACTIVE = ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const needKey = (id: string) => PREFIX + "need:" + id;
const pairKey = (propertyId: string, itemId: string) => PREFIX + "open:" + hash([propertyId, itemId]);
const json = (value: unknown) => value as Prisma.InputJsonValue;
async function lock(tx: Tx, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; }
async function save(tx: Tx, key: string, value: unknown) { await tx.appSetting.upsert({ where: { key }, create: { key, value: json(value) }, update: { value: json(value) } }); }
function record(row: { value: unknown } | null) { return row?.value as UrgentNeed | undefined; }
function assignment(userId: string) { return { userId, removedAt: null, responseStatus: { in: ["PENDING", "ACCEPTED"] as ("PENDING" | "ACCEPTED")[] } }; }

async function actorRole(tx: Tx, actor: StockActor) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { isActive: true, role: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive) throw new Error("UNAUTHORIZED");
  if (![user.role, ...user.extraRoles.map(row => row.role)].includes(actor.role) || ![Role.ADMIN, Role.CLEANER].includes(actor.role as any)) throw new Error("FORBIDDEN");
  return actor.role;
}
export async function urgentStockProperties(actor: StockActor, tx: Tx = db) {
  const role = await actorRole(tx, actor);
  return tx.property.findMany({ where: { isActive: true, inventoryEnabled: true,
    ...(role === Role.ADMIN ? {} : { jobs: { some: { status: { in: [...ACTIVE] }, cleanSkipStatus: { not: "SKIPPED" }, assignments: { some: assignment(actor.id) } } } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
async function scope(tx: Tx, actor: StockActor, propertyId: string) {
  if (!(await urgentStockProperties(actor, tx)).some(property => property.id === propertyId)) throw new Error("FORBIDDEN");
}
export async function urgentStockSettings(tx: Tx = db) {
  const row = await tx.appSetting.findUnique({ where: { key: SETTINGS } });
  return urgentStockReminderSettings.parse(row?.value ?? DEFAULTS);
}
export async function setUrgentStockSettings(actor: StockActor, input: unknown) {
  const settings = urgentStockReminderSettings.parse(input);
  return db.$transaction(async tx => {
    if (await actorRole(tx, actor) !== Role.ADMIN) throw new Error("FORBIDDEN");
    await save(tx, SETTINGS, settings);
    await tx.auditLog.create({ data: { userId: actor.id, action: "URGENT_STOCK_REMINDERS_UPDATED", entity: "AppSetting", entityId: SETTINGS, after: json(settings) } });
    return settings;
  });
}
export async function nextUrgentStockClean(tx: Tx, propertyId: string, now: Date, timezone: string) {
  const jobs = await tx.job.findMany({ where: { propertyId, status: { in: [...ACTIVE] }, cleanSkipStatus: { not: "SKIPPED" }, scheduledDate: { gte: new Date(now.getTime() - 86400000) } }, orderBy: { scheduledDate: "asc" }, select: { id: true, scheduledDate: true, startTime: true, dueTime: true, internalNotes: true }, take: 100 });
  return jobs.flatMap(job => {
    const meta = parseJobInternalNotes(job.internalNotes);
    if (meta.isDraft) return [];
    const time = job.startTime || job.dueTime;
    // Unknown times stay conservative: local day start is the planning deadline.
    const date = fromZonedTime(`${job.scheduledDate.toISOString().slice(0, 10)}T${time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00"}:00`, timezone);
    return Number.isFinite(date.getTime()) ? [date] : [];
  }).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
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
async function event(tx: Tx, need: UrgentNeed, actorId: string | null, kind: string, detail: unknown) {
  const user = actorId ? await tx.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null;
  await tx.appSetting.create({ data: { key: PREFIX + "event:" + need.id + ":" + randomUUID(), value: json({ reportId: need.id, propertyId: need.propertyId, actorId, actorName: user?.name ?? (actorId ? "Team member" : "Reminder worker"), kind, at: need.updatedAt, detail }) } });
}
async function notify(tx: Tx, need: UrgentNeed, kind: string, nextCleanAt?: Date | null) {
  const admins = await tx.user.findMany({ where: { isActive: true, OR: [{ role: Role.ADMIN }, { extraRoles: { some: { role: Role.ADMIN } } }] }, select: { id: true } });
  if (!admins.length) return false;
  // In-app only. No email, SMS, purchase or external dispatch is performed.
  await tx.notification.createMany({ data: admins.map(admin => ({ userId: admin.id, channel: "PUSH", status: "SENT", sentAt: new Date(), subject: `Urgent stock: ${need.propertyName} — ${need.itemName}`,
    body: `${kind}. ${need.stage}. Observed count: ${need.observedCount ?? "unknown"}; requested purchase: ${need.purchaseQuantity ?? "unknown"}. ${nextCleanAt ? `Next clean planning deadline: ${nextCleanAt.toISOString()}. ` : ""}Review /urgent-stock?propertyId=${encodeURIComponent(need.propertyId)}` })) });
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
  return db.$transaction(async tx => {
    await scope(tx, actor, input.propertyId);
    const request = await receipt(tx, actor, input.requestId, input);
    if (request.previous) return request.previous;
    const key = pairKey(input.propertyId, input.itemId);
    await lock(tx, key);
    const existing = await tx.appSetting.findUnique({ where: { key } });
    const openId = (existing?.value as { id?: string } | undefined)?.id;
    const previous = openId ? record(await tx.appSetting.findUnique({ where: { key: needKey(openId) } })) : undefined;
    const property = await tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } });
    const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item?.isActive) throw new Error("Item is unavailable.");
    const now = new Date();
    const disposition = await observation(tx, input.propertyId, input.itemId, input.observedCount, input.observedAt, now, actor.id);
    const need: UrgentNeed = { id: previous?.id ?? randomUUID(), propertyId: input.propertyId, itemId: input.itemId, propertyName: property.name, itemName: item.name, unit: item.unit,
      stage: previous?.stage ?? "REPORTED", createdAt: previous?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(), version: (previous?.version ?? 0) + 1,
      observedCount: input.observedCount, purchaseQuantity: input.purchaseQuantity, observedAt: input.observedAt, observationDisposition: disposition, note: input.note,
      lastReminderAt: previous?.lastReminderAt ?? null, remindersSent: previous?.remindersSent ?? 0 };
    await save(tx, needKey(need.id), need); await save(tx, key, { id: need.id });
    await event(tx, need, actor.id, previous ? "REPORT_UPDATED" : "REPORTED", { ...input, observationDisposition: disposition });
    if (!previous) await notify(tx, need, "Reported need remains open");
    await save(tx, request.key, { fingerprint: request.fingerprint, result: need });
    return need;
  });
}
export const urgentStockActionInput = z.object({
  reportId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  stage: z.enum(URGENT_STOCK_STAGES), reason: z.string().trim().min(1).max(2000),
  observedCount: z.number().finite().nonnegative().max(1_000_000).nullable(), observedAt: z.string().datetime({ offset: true }).nullable(), needResolved: z.boolean(),
}).strict();
export async function actOnUrgentStock(actor: StockActor, raw: unknown) {
  const input = urgentStockActionInput.parse(raw);
  return db.$transaction(async tx => {
    const initial = record(await tx.appSetting.findUnique({ where: { key: needKey(input.reportId) } }));
    if (!initial) throw new Error("NOT_FOUND");
    await scope(tx, actor, initial.propertyId);
    const request = await receipt(tx, actor, input.requestId, input);
    if (request.previous) return request.previous;
    const key = pairKey(initial.propertyId, initial.itemId); await lock(tx, key);
    const need = record(await tx.appSetting.findUnique({ where: { key: needKey(input.reportId) } }))!;
    if (need.version !== input.expectedVersion) throw new Error("CONFLICT: this report changed. Reload before recording an action.");
    const now = new Date();
    let disposition = "UNKNOWN";
    if (input.stage === "PROPERTY_CONFIRMED") disposition = await observation(tx, need.propertyId, need.itemId, input.observedCount, input.observedAt, now, actor.id);
    else if (input.observedCount !== null || input.observedAt !== null || input.needResolved) throw new Error("Only property confirmation records a new count.");
    validateUrgentStockTransition({ from: need.stage, to: input.stage, isAdmin: actor.role === Role.ADMIN, reason: input.reason,
      confirmation: { observedCount: input.observedCount, observationApplied: disposition === "APPLY", needResolved: input.needResolved, reason: input.reason } });
    const updated = { ...need, stage: input.stage, updatedAt: now.toISOString(), version: need.version + 1,
      ...(input.stage === "PROPERTY_CONFIRMED" ? { observedCount: input.observedCount, observedAt: input.observedAt, observationDisposition: disposition } : {}) };
    await save(tx, needKey(need.id), updated); await event(tx, updated, actor.id, input.stage, { ...input, observationDisposition: disposition });
    if (isUrgentStockClosed(updated.stage)) await tx.appSetting.delete({ where: { key } });
    await save(tx, request.key, { fingerprint: request.fingerprint, result: updated });
    return updated;
  });
}
export async function listUrgentStock(actor: StockActor, propertyId?: string, reportId?: string) {
  const properties = await urgentStockProperties(actor);
  if (!propertyId) return { properties, items: [], reports: [], events: [], settings: actor.role === Role.ADMIN ? await urgentStockSettings() : null };
  if (!properties.some(property => property.id === propertyId)) throw new Error("FORBIDDEN");
  const [items, rows, events] = await Promise.all([
    db.propertyStock.findMany({ where: { propertyId, item: { isActive: true } }, select: { itemId: true, item: { select: { name: true, unit: true } } }, orderBy: { item: { name: "asc" } } }),
    db.appSetting.findMany({ where: { key: { startsWith: PREFIX + "need:" }, value: { path: ["propertyId"], equals: propertyId } }, orderBy: { updatedAt: "desc" } }),
    reportId ? db.appSetting.findMany({ where: { key: { startsWith: PREFIX + "event:" + reportId + ":" }, value: { path: ["propertyId"], equals: propertyId } }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
  ]);
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const nextCleanAt = await nextUrgentStockClean(db, propertyId, new Date(), timezone);
  return { properties, items, reports: rows.map(row => record(row)!), events: events.map(row => row.value), nextCleanAt: nextCleanAt?.toISOString() ?? null, settings: actor.role === Role.ADMIN ? await urgentStockSettings() : null };
}
export async function dispatchUrgentStockReminders(now = new Date()) {
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const open = await db.appSetting.findMany({ where: { key: { startsWith: PREFIX + "open:" } }, select: { key: true, value: true } });
  let sent = 0;
  for (const row of open) {
    sent += await db.$transaction(async tx => {
      await lock(tx, row.key);
      const pointer = await tx.appSetting.findUnique({ where: { key: row.key } });
      if (!pointer) return 0;
      const need = record(await tx.appSetting.findUnique({ where: { key: needKey((pointer.value as { id: string }).id) } }));
      if (!need) return 0;
      const nextCleanAt = await nextUrgentStockClean(tx, need.propertyId, now, timezone);
      if (!urgentStockReminderDue({ settings: await urgentStockSettings(tx), stage: need.stage, now, createdAt: new Date(need.createdAt), lastReminderAt: need.lastReminderAt ? new Date(need.lastReminderAt) : null, remindersSent: need.remindersSent, nextCleanAt })) return 0;
      if (!await notify(tx, need, "Unresolved stock reminder", nextCleanAt)) return 0;
      const updated = { ...need, updatedAt: now.toISOString(), lastReminderAt: now.toISOString(), remindersSent: need.remindersSent + 1 };
      await save(tx, needKey(need.id), updated); await event(tx, updated, null, "REMINDER", { nextCleanAt: nextCleanAt?.toISOString() ?? null, number: updated.remindersSent });
      return 1;
    });
  }
  return { sent };
}
