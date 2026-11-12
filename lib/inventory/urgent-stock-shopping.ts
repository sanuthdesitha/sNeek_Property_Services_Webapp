/**
 * "Add to shopping run" on urgent needs (Wave F, owner decision five, item 1).
 *
 * Uses the existing shopping-run domain (ShoppingRun / ShoppingRunLine, the
 * same tables the cleaner, client and office shopping screens edit): the need's
 * item and quantity become a PLANNED line on an open run, or on a new DRAFT run
 * owned by the office user, and the need records which run it is on.
 *
 * What it does NOT do: it never marks the need ordered, bought or delivered,
 * never places a purchase and never touches costs, settlements or stock. The
 * need moves on only through its own stage actions; the line's purchase is
 * recorded by whoever shops the run, and on-hand changes only through the
 * existing evidence paths (deliveries, counts, property confirmation).
 *
 * Rules: a run is open while DRAFT or ACTIVE, not submitted and not settled;
 * anything else is refused with the reason. Idempotent per request id (a
 * receipt) and per need (a need already on this run is answered "already").
 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma, ShoppingRunStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUrgentStockAdmin, urgentStockPairKey, type StockActor } from "./urgent-stock";
import { appendNeedEvent, needFromRow } from "./urgent-stock-store";
import { isUrgentStockClosed, type UrgentStockStage } from "./urgent-stock-policy";
import { suggestedBuy } from "./urgent-stock-actions";

type Tx = Prisma.TransactionClient;

export const OPEN_SHOPPING_RUN_STATUSES: ShoppingRunStatus[] = [ShoppingRunStatus.DRAFT, ShoppingRunStatus.ACTIVE];
export const ADD_TO_RUN_MAX = 50;

export const addToRunInput = z.object({
  requestId: z.string().uuid(),
  needIds: z.array(z.string().uuid()).min(1).max(ADD_TO_RUN_MAX),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), runId: z.string().min(1).max(200) }).strict(),
    z.object({ kind: z.literal("new"), title: z.string().trim().min(1).max(120) }).strict(),
  ]),
  /** Quantity to plan per need; a need without one falls back to its request, then par less count. */
  quantities: z.record(z.string().uuid(), z.number().finite().positive().max(1_000_000)).optional(),
}).strict();

export type AddToRunResult = { id: string; outcome: "done" | "already" | "refused"; message: string };
export type AddToRunResponse = { run: { id: string; title: string }; results: AddToRunResult[] };

type RunFacts = {
  status: ShoppingRunStatus;
  submittedAt: Date | null;
  settlements: Array<{ includedInClientInvoiceId: string | null; includedInCleanerInvoiceId: string | null; includedInPayrollRunId: string | null; timeIncludedInCleanerInvoiceId: string | null; timeIncludedInPayrollRunId: string | null }>;
};

/** Pure: why a run cannot take new lines, or null when it is open. */
export function shoppingRunClosedReason(run: RunFacts): string | null {
  if (run.submittedAt) return "This shopping run was already submitted, so it is closed. Choose an open run or start a new one.";
  if (!OPEN_SHOPPING_RUN_STATUSES.includes(run.status)) return `This shopping run is ${run.status.toLowerCase()}, so it is closed. Choose an open run or start a new one.`;
  const settled = run.settlements.some((row) => row.includedInClientInvoiceId || row.includedInCleanerInvoiceId || row.includedInPayrollRunId || row.timeIncludedInCleanerInvoiceId || row.timeIncludedInPayrollRunId);
  return settled ? "This shopping run has been billed or paid, so it is closed. Start a new one." : null;
}

/** Pure: the quantity to plan, never a guessed zero. */
export function plannedQuantityFor(input: { chosen?: number; purchaseQuantity: number | null; parLevel: number | null; observedCount: number | null }): number | null {
  if (input.chosen && input.chosen > 0) return input.chosen;
  if (input.purchaseQuantity && input.purchaseQuantity > 0) return input.purchaseQuantity;
  const suggestion = suggestedBuy(input.parLevel, input.observedCount);
  return suggestion && suggestion > 0 ? suggestion : null;
}

export type OpenRunOption = { id: string; title: string; ownerName: string; status: string; lineCount: number; properties: string[]; updatedAt: string };

/** Open runs the office can add to (newest first). */
export async function listOpenShoppingRuns(actor: StockActor): Promise<OpenRunOption[]> {
  await requireUrgentStockAdmin(actor, db, "read");
  const runs = await db.shoppingRun.findMany({
    where: { status: { in: OPEN_SHOPPING_RUN_STATUSES }, submittedAt: null },
    select: {
      id: true, title: true, status: true, updatedAt: true,
      owner: { select: { name: true, email: true } },
      lines: { select: { property: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return runs.map((run) => ({
    id: run.id,
    title: run.title,
    ownerName: run.owner.name?.trim() || run.owner.email,
    status: run.status,
    lineCount: run.lines.length,
    properties: Array.from(new Set(run.lines.map((line) => line.property?.name).filter((name): name is string => Boolean(name)))),
    updatedAt: run.updatedAt.toISOString(),
  }));
}

const receiptKey = (actorId: string, requestId: string) =>
  "urgent_stock_v1:run_receipt:" + createHash("sha256").update(JSON.stringify([actorId, requestId])).digest("hex");

async function lockRun(tx: Tx, input: z.infer<typeof addToRunInput>, actor: StockActor, singlePropertyId: string | null) {
  if (input.target.kind === "new") {
    return tx.shoppingRun.create({
      data: {
        id: randomUUID(), ownerUserId: actor.id, status: ShoppingRunStatus.DRAFT, title: input.target.title,
        legacySource: { ownerScope: "CLEANER", planningScope: singlePropertyId ?? "all", source: "urgent-stock" },
      },
      select: { id: true, title: true },
    });
  }
  await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${input.target.runId} FOR UPDATE`;
  const run = await tx.shoppingRun.findUnique({ where: { id: input.target.runId }, include: { settlements: true } });
  if (!run) throw new Error("NOT_FOUND");
  const closed = shoppingRunClosedReason(run);
  if (closed) throw new Error(`CONFLICT: ${closed}`);
  return { id: run.id, title: run.title };
}

export const NEED_WITH_RUN_INCLUDE = { shoppingRun: { include: { settlements: true } }, purchaseAsks: true } satisfies Prisma.UrgentStockNeedInclude;
export type NeedWithRun = Prisma.UrgentStockNeedGetPayload<{ include: typeof NEED_WITH_RUN_INCLUDE }>;

/**
 * Puts one need on a locked, open run (shared with "Ask cleaner to buy" when
 * the cleaner accepts). The caller holds the need's pair lock and the run lock.
 * `acceptingAskId` is the ask being accepted, which does not block itself.
 */
export async function attachNeedToRun(tx: Tx, actor: { id: string }, row: NeedWithRun, run: { id: string; title: string }, chosen: number | undefined, now: Date, acceptingAskId?: string): Promise<AddToRunResult> {
  const stage = row.stage as UrgentStockStage;
  if (isUrgentStockClosed(stage)) return { id: row.id, outcome: "refused", message: "This need is closed." };
  if (row.shoppingRunId === run.id) return { id: row.id, outcome: "already", message: `Already on ${run.title}.` };
  if (row.shoppingRun && !shoppingRunClosedReason(row.shoppingRun)) return { id: row.id, outcome: "refused", message: `Already on the open run "${row.shoppingRun.title}".` };
  if (row.purchaseAsks.some((ask) => ask.state === "ASKED" && ask.id !== acceptingAskId)) return { id: row.id, outcome: "refused", message: "A cleaner was asked to buy this. Withdraw the ask first." };
  const stock = await tx.propertyStock.findUnique({ where: { propertyId_itemId: { propertyId: row.propertyId, itemId: row.itemId } }, select: { parLevel: true } });
  const quantity = plannedQuantityFor({ chosen, purchaseQuantity: row.purchaseQuantity, parLevel: stock && stock.parLevel > 0 ? stock.parLevel : null, observedCount: row.observedCount });
  if (quantity === null) return { id: row.id, outcome: "refused", message: "Enter how many to buy: the need has no requested quantity and no count with a par level." };
  const item = await tx.inventoryItem.findUnique({ where: { id: row.itemId }, select: { id: true, name: true, category: true, supplier: true, unit: true } });
  const existingLine = await tx.shoppingRunLine.findFirst({ where: { shoppingRunId: run.id, propertyId: row.propertyId, itemId: item ? item.id : undefined, itemName: item ? undefined : row.itemName } });
  if (!existingLine) {
    await tx.shoppingRunLine.create({
      data: {
        shoppingRunId: run.id, propertyId: row.propertyId, itemId: item?.id ?? null, itemName: item?.name ?? row.itemName,
        category: item?.category ?? "General", supplier: item?.supplier ?? null, unit: item?.unit ?? row.unit,
        plannedQty: quantity, status: "PLANNED", note: `Urgent need: ${row.itemName} at ${row.propertyName}`,
      },
    });
  }
  const updated = await tx.urgentStockNeed.update({
    where: { id: row.id },
    data: { shoppingRunId: run.id, shoppingRunAddedAt: now, shoppingRunAddedById: actor.id, version: { increment: 1 }, updatedAt: now },
  });
  const actorName = (await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? "Team member";
  await appendNeedEvent(tx, needFromRow(updated), {
    actorId: actor.id, actorName, kind: "ADDED_TO_SHOPPING_RUN", fromStage: stage,
    detail: { runId: run.id, runTitle: run.title, quantity, lineCreated: !existingLine, existingPlannedQty: existingLine?.plannedQty ?? null },
  });
  return { id: row.id, outcome: "done", message: existingLine ? `Linked to the line already on ${run.title} (planned ${existingLine.plannedQty}).` : `Added to ${run.title}: ${quantity} ${row.unit}.` };
}

export async function addUrgentNeedsToShoppingRun(actor: StockActor, raw: unknown): Promise<AddToRunResponse> {
  const input = addToRunInput.parse(raw);
  const needIds = Array.from(new Set(input.needIds));
  return db.$transaction(async (tx) => {
    await requireUrgentStockAdmin(actor, tx, "manage");
    const key = receiptKey(actor.id, input.requestId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, needIds })).digest("hex");
    const previous = (await tx.appSetting.findUnique({ where: { key } }))?.value as { fingerprint: string; result: AddToRunResponse } | undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error("CONFLICT: request ID already used for different data.");
      return previous.result;
    }
    const heads = await tx.urgentStockNeed.findMany({ where: { id: { in: needIds } }, select: { id: true, propertyId: true, itemId: true } });
    for (const head of [...heads].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${urgentStockPairKey(head.propertyId, head.itemId)}, 0))`;
    }
    const properties = new Set(heads.map((head) => head.propertyId));
    const run = await lockRun(tx, input, actor, properties.size === 1 ? Array.from(properties)[0] : null);
    const rows = await tx.urgentStockNeed.findMany({ where: { id: { in: needIds } }, include: NEED_WITH_RUN_INCLUDE });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const now = new Date();
    const results: AddToRunResult[] = [];
    for (const id of needIds) {
      const row = byId.get(id);
      results.push(row ? await attachNeedToRun(tx, actor, row, run, input.quantities?.[id], now) : { id, outcome: "refused", message: "This need no longer exists." });
    }
    if (input.target.kind === "new" && !results.some((result) => result.outcome === "done")) {
      // Roll back the new run: an empty run nobody asked for helps no one.
      throw new Error(`CONFLICT: Nothing was added, so no run was started. ${results.map((result) => result.message).join(" ")}`);
    }
    if (input.target.kind === "existing" && results.some((result) => result.outcome === "done")) {
      // Touch the run so an owner editing an older copy is refused by its stale-write guard.
      await tx.shoppingRun.update({ where: { id: run.id }, data: { updatedAt: now } });
    }
    const result: AddToRunResponse = { run, results };
    await tx.appSetting.create({ data: { key, value: { fingerprint, result } as unknown as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "URGENT_STOCK_ADDED_TO_SHOPPING_RUN", entity: "ShoppingRun", entityId: run.id, after: { results, newRun: input.target.kind === "new" } as unknown as Prisma.InputJsonValue } });
    return result;
  });
}
