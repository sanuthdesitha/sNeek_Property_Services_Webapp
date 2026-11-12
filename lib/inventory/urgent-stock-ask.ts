/**
 * "Ask cleaner to buy" on an urgent need (Wave F, owner decision five, item 2).
 *
 * The office asks one cleaner (by default a cleaner on the next clean at the
 * property) to buy the item. States: ASKED -> ACCEPTED | DECLINED, or WITHDRAWN
 * by the office while still ASKED. Accepting puts the need on the cleaner's own
 * open shopping run (or a new DRAFT run they own) through the shared
 * attachNeedToRun, so the purchase, receipt and reimbursement follow the
 * existing shopping path, where the office approves the reimbursement.
 *
 * "Bought" is never stored or set here: purchaseAskState() reads it from the
 * cleaner's run (submitted, line purchased, reimbursement approved by the
 * office). The notice goes through the notification pipeline
 * (lib/inventory/urgent-stock-ask-notify.ts) with transports the office chose;
 * the inbox is the default and alone never becomes a push or an email.
 */
import { Prisma, Role, ShoppingRunStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { requireUrgentStockAdmin, urgentStockCleanDeadline, urgentStockCleanWhere, urgentStockPairKey, type StockActor } from "./urgent-stock";
import { appendNeedEvent, needFromRow } from "./urgent-stock-store";
import { isUrgentStockClosed, type UrgentStockStage } from "./urgent-stock-policy";
import { NEED_WITH_RUN_INCLUDE, OPEN_SHOPPING_RUN_STATUSES, attachNeedToRun, plannedQuantityFor, shoppingRunClosedReason } from "./urgent-stock-shopping";

type Tx = Prisma.TransactionClient;

export const ASK_TRANSPORTS = ["INBOX", "PUSH", "EMAIL"] as const;
export type AskTransport = (typeof ASK_TRANSPORTS)[number];

export const askCleanerInput = z.object({
  needId: z.string().uuid(),
  requestKey: z.string().uuid(),
  cleanerId: z.string().min(1).max(200),
  jobId: z.string().min(1).max(200).nullable(),
  quantity: z.number().finite().positive().max(1_000_000).nullable(),
  note: z.string().trim().max(1000).nullable(),
  transports: z.array(z.enum(ASK_TRANSPORTS)).min(1).max(3),
}).strict();

export const askAnswerInput = z.object({
  decision: z.enum(["accept", "decline"]),
  note: z.string().trim().max(1000).nullable(),
}).strict();

export type CreatedAsk = { id: string; cleanerId: string; cleanerName: string; jobId: string | null; jobNumber: string | null; propertyName: string; itemName: string; quantity: number; unit: string; note: string | null; transports: AskTransport[]; created: boolean };

const ACTIVE_JOB_ASSIGNMENT = { removedAt: null, responseStatus: { in: ["PENDING", "ACCEPTED"] as ("PENDING" | "ACCEPTED")[] } };

/** Pure: a refusal for a new ask on this need, or null. */
export function askRefusal(need: { stage: string; shoppingRun: { title: string; status: ShoppingRunStatus; submittedAt: Date | null; settlements: Parameters<typeof shoppingRunClosedReason>[0]["settlements"] } | null; purchaseAsks: Array<{ state: string; cleanerName: string }> }): string | null {
  if (isUrgentStockClosed(need.stage as UrgentStockStage)) return "This need is closed.";
  const live = need.purchaseAsks.find((ask) => ask.state === "ASKED" || ask.state === "ACCEPTED");
  if (live) return `${live.cleanerName} was already asked (${live.state.toLowerCase()}).`;
  if (need.shoppingRun && !shoppingRunClosedReason(need.shoppingRun)) return `Already on the open run "${need.shoppingRun.title}".`;
  return null;
}

export type AskCandidates = {
  nextJob: { id: string; jobNumber: string | null; deadline: string | null; cleaners: Array<{ id: string; name: string }> } | null;
  cleaners: Array<{ id: string; name: string }>;
};

/** Who can be asked: the next clean's cleaners first, then any active cleaner. */
export async function askCandidates(actor: StockActor, needId: string, now = new Date()): Promise<AskCandidates> {
  await requireUrgentStockAdmin(actor, db, "read");
  const need = await db.urgentStockNeed.findUnique({ where: { id: needId }, select: { propertyId: true } });
  if (!need) throw new Error("NOT_FOUND");
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const jobs = await db.job.findMany({
    where: { propertyId: need.propertyId, ...urgentStockCleanWhere(now) },
    select: { id: true, jobNumber: true, scheduledDate: true, startTime: true, dueTime: true, internalNotes: true, assignments: { where: { ...ACTIVE_JOB_ASSIGNMENT, user: { isActive: true, role: Role.CLEANER } }, select: { user: { select: { id: true, name: true, email: true } } } } },
    orderBy: { scheduledDate: "asc" },
    take: 50,
  });
  const dated = jobs.flatMap((job) => {
    const deadline = urgentStockCleanDeadline(job, timezone);
    return deadline && deadline.getTime() >= now.getTime() - 86_400_000 ? [{ job, deadline }] : [];
  }).sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  const next = dated[0] ?? null;
  const cleaners = await db.user.findMany({ where: { isActive: true, role: Role.CLEANER }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 300 });
  const label = (user: { name: string | null; email: string }) => user.name?.trim() || user.email;
  return {
    nextJob: next ? { id: next.job.id, jobNumber: next.job.jobNumber, deadline: next.deadline.toISOString(), cleaners: next.job.assignments.map(({ user }) => ({ id: user.id, name: label(user) })) } : null,
    cleaners: cleaners.map((user) => ({ id: user.id, name: label(user) })),
  };
}

async function lockNeed(tx: Tx, needId: string) {
  const head = await tx.urgentStockNeed.findUnique({ where: { id: needId }, select: { propertyId: true, itemId: true } });
  if (!head) throw new Error("NOT_FOUND");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${urgentStockPairKey(head.propertyId, head.itemId)}, 0))`;
  return tx.urgentStockNeed.findUniqueOrThrow({ where: { id: needId }, include: NEED_WITH_RUN_INCLUDE });
}

async function bumpNeed(tx: Tx, needId: string, now: Date) {
  return tx.urgentStockNeed.update({ where: { id: needId }, data: { version: { increment: 1 }, updatedAt: now } });
}

/** Creates the ask (state ASKED). Idempotent per request key. The caller sends the notice. */
export async function createPurchaseAsk(actor: StockActor, raw: unknown): Promise<CreatedAsk> {
  const input = askCleanerInput.parse(raw);
  const settings = await getAppSettings();
  if (!isCleanerModuleEnabled(settings, "shopping")) throw new Error("Shopping is turned off for cleaners, so a cleaner cannot be asked to buy. Turn it on in Settings or add the need to a shopping run.");
  return db.$transaction(async (tx) => {
    await requireUrgentStockAdmin(actor, tx, "manage");
    const repeat = await tx.urgentStockPurchaseAsk.findUnique({ where: { requestKey: input.requestKey }, include: { need: true, job: { select: { jobNumber: true } } } });
    if (repeat) {
      if (repeat.needId !== input.needId || repeat.cleanerId !== input.cleanerId) throw new Error("CONFLICT: request key already used for a different ask.");
      return { id: repeat.id, cleanerId: repeat.cleanerId, cleanerName: repeat.cleanerName, jobId: repeat.jobId, jobNumber: repeat.job?.jobNumber ?? null, propertyName: repeat.need.propertyName, itemName: repeat.need.itemName, quantity: repeat.quantity ?? 0, unit: repeat.need.unit, note: repeat.note, transports: repeat.transports as AskTransport[], created: false };
    }
    const need = await lockNeed(tx, input.needId);
    const refusal = askRefusal(need);
    if (refusal) throw new Error(`CONFLICT: ${refusal}`);
    const cleaner = await tx.user.findFirst({ where: { id: input.cleanerId, isActive: true, role: Role.CLEANER }, select: { id: true, name: true, email: true } });
    if (!cleaner) throw new Error("Choose an active cleaner.");
    let jobNumber: string | null = null;
    if (input.jobId) {
      const job = await tx.job.findFirst({ where: { id: input.jobId, propertyId: need.propertyId, assignments: { some: { userId: cleaner.id, ...ACTIVE_JOB_ASSIGNMENT } } }, select: { jobNumber: true } });
      if (!job) throw new Error("That cleaner is not on that job at this property.");
      jobNumber = job.jobNumber;
    }
    const stock = await tx.propertyStock.findUnique({ where: { propertyId_itemId: { propertyId: need.propertyId, itemId: need.itemId } }, select: { parLevel: true } });
    const quantity = plannedQuantityFor({ chosen: input.quantity ?? undefined, purchaseQuantity: need.purchaseQuantity, parLevel: stock && stock.parLevel > 0 ? stock.parLevel : null, observedCount: need.observedCount });
    if (quantity === null) throw new Error("Enter how many to buy: the need has no requested quantity and no count with a par level.");
    const asker = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
    const askerName = asker?.name?.trim() || asker?.email || "Office";
    const cleanerName = cleaner.name?.trim() || cleaner.email;
    const ask = await tx.urgentStockPurchaseAsk.create({
      data: {
        needId: need.id, cleanerId: cleaner.id, cleanerName, jobId: input.jobId, state: "ASKED", activeKey: need.id,
        askedById: actor.id, askedByName: askerName, note: input.note, quantity, transports: input.transports, requestKey: input.requestKey,
      },
    });
    const updated = await bumpNeed(tx, need.id, new Date());
    await appendNeedEvent(tx, needFromRow(updated), { actorId: actor.id, actorName: askerName, kind: "ASKED_CLEANER_TO_BUY", fromStage: need.stage as UrgentStockStage, detail: { askId: ask.id, cleanerId: cleaner.id, cleanerName, jobId: input.jobId, quantity, transports: input.transports, note: input.note } });
    return { id: ask.id, cleanerId: cleaner.id, cleanerName, jobId: input.jobId, jobNumber, propertyName: need.propertyName, itemName: need.itemName, quantity, unit: need.unit, note: input.note, transports: input.transports, created: true };
  });
}

/** Records the transport outcomes on the ask (states as the pipeline reported them; never "delivered"). */
export async function recordAskOutcomes(askId: string, outcomes: unknown) {
  await db.urgentStockPurchaseAsk.update({ where: { id: askId }, data: { outcomes: outcomes as Prisma.InputJsonValue } });
}

/** The office withdraws an ask that was not answered yet. */
export async function withdrawPurchaseAsk(actor: StockActor, askId: string, reason: string) {
  return db.$transaction(async (tx) => {
    await requireUrgentStockAdmin(actor, tx, "manage");
    const head = await tx.urgentStockPurchaseAsk.findUnique({ where: { id: askId }, select: { needId: true } });
    if (!head) throw new Error("NOT_FOUND");
    const need = await lockNeed(tx, head.needId);
    const ask = await tx.urgentStockPurchaseAsk.findUniqueOrThrow({ where: { id: askId } });
    if (ask.state !== "ASKED") throw new Error(`CONFLICT: This ask was already ${ask.state.toLowerCase()}.`);
    const now = new Date();
    await tx.urgentStockPurchaseAsk.update({ where: { id: askId }, data: { state: "WITHDRAWN", activeKey: null, respondedAt: now, responseNote: reason.trim().slice(0, 1000) || null } });
    const updated = await bumpNeed(tx, need.id, now);
    const name = (await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? "Office";
    await appendNeedEvent(tx, needFromRow(updated), { actorId: actor.id, actorName: name, kind: "PURCHASE_ASK_WITHDRAWN", fromStage: need.stage as UrgentStockStage, detail: { askId, reason } });
    return { id: askId, state: "WITHDRAWN" as const };
  });
}

async function cleanerOpenRun(tx: Tx, cleanerId: string, propertyId: string, title: string) {
  const runs = await tx.shoppingRun.findMany({ where: { ownerUserId: cleanerId, status: { in: OPEN_SHOPPING_RUN_STATUSES }, submittedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true }, take: 5 });
  for (const candidate of runs) {
    await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${candidate.id} FOR UPDATE`;
    const run = await tx.shoppingRun.findUnique({ where: { id: candidate.id }, include: { settlements: true } });
    if (run && !shoppingRunClosedReason(run)) return { id: run.id, title: run.title, created: false };
  }
  const created = await tx.shoppingRun.create({
    data: { ownerUserId: cleanerId, status: ShoppingRunStatus.DRAFT, title, legacySource: { ownerScope: "CLEANER", planningScope: propertyId, source: "urgent-stock-ask" } },
    select: { id: true, title: true },
  });
  return { ...created, created: true };
}

/** The asked cleaner accepts (the need goes on their shopping run) or declines. */
export async function answerPurchaseAsk(cleaner: { id: string; role: Role }, askId: string, raw: unknown) {
  const input = askAnswerInput.parse(raw);
  if (cleaner.role !== Role.CLEANER) throw new Error("FORBIDDEN");
  if (input.decision === "accept" && !isCleanerModuleEnabled(await getAppSettings(), "shopping")) throw new Error("Shopping is turned off for cleaners. Tell the office.");
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: cleaner.id }, select: { isActive: true, role: true, name: true, email: true } });
    if (!user?.isActive || user.role !== Role.CLEANER) throw new Error("FORBIDDEN");
    const head = await tx.urgentStockPurchaseAsk.findUnique({ where: { id: askId }, select: { needId: true, cleanerId: true } });
    if (!head || head.cleanerId !== cleaner.id) throw new Error("NOT_FOUND");
    const need = await lockNeed(tx, head.needId);
    const ask = await tx.urgentStockPurchaseAsk.findUniqueOrThrow({ where: { id: askId } });
    if (ask.state !== "ASKED") throw new Error(`CONFLICT: This request was already ${ask.state.toLowerCase()}.`);
    const now = new Date();
    const name = user.name?.trim() || user.email;
    if (input.decision === "decline") {
      await tx.urgentStockPurchaseAsk.update({ where: { id: askId }, data: { state: "DECLINED", activeKey: null, respondedAt: now, responseNote: input.note } });
      const updated = await bumpNeed(tx, need.id, now);
      await appendNeedEvent(tx, needFromRow(updated), { actorId: cleaner.id, actorName: name, kind: "CLEANER_DECLINED_TO_BUY", fromStage: need.stage as UrgentStockStage, detail: { askId, note: input.note } });
      return { id: askId, state: "DECLINED" as const, runId: null };
    }
    if (isUrgentStockClosed(need.stage as UrgentStockStage)) throw new Error("CONFLICT: The office closed this need. Nothing to buy.");
    const run = await cleanerOpenRun(tx, cleaner.id, need.propertyId, `Urgent stock · ${need.propertyName}`);
    const attached = await attachNeedToRun(tx, { id: cleaner.id }, need, run, ask.quantity ?? undefined, now, askId);
    if (attached.outcome === "refused") throw new Error(`CONFLICT: ${attached.message}`);
    await tx.urgentStockPurchaseAsk.update({ where: { id: askId }, data: { state: "ACCEPTED", respondedAt: now, responseNote: input.note, shoppingRunId: run.id } });
    if (!run.created) await tx.shoppingRun.update({ where: { id: run.id }, data: { updatedAt: now } });
    const updated = await bumpNeed(tx, need.id, now);
    await appendNeedEvent(tx, needFromRow(updated), { actorId: cleaner.id, actorName: name, kind: "CLEANER_ACCEPTED_TO_BUY", fromStage: need.stage as UrgentStockStage, detail: { askId, runId: run.id, runTitle: run.title, note: input.note } });
    return { id: askId, state: "ACCEPTED" as const, runId: run.id };
  });
}
