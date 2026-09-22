import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordOwnHeldStock, HeldStockEntryError } from "./self-held-stock";
import { deliverHeldStock } from "./held-stock";
import { accessiblePropertyWhereForCleaner } from "./cleaner-scope";
const quantity = z.number().finite().positive().max(1_000_000);
export const heldStockBatchSchema = z.discriminatedUnion("action", [
  z.object({ requestId: z.string().uuid(), action: z.literal("RECORD"), entries: z.array(z.object({ itemId: z.string().min(1).max(200), quantity, sourceNote: z.string().trim().max(2000).default("") }).strict()).min(1).max(50) }).strict(),
  z.object({ requestId: z.string().uuid(), action: z.literal("DELIVER"), propertyId: z.string().min(1).max(200), entries: z.array(z.object({ heldStockId: z.string().min(1).max(200), quantity }).strict()).min(1).max(50) }).strict(),
]).superRefine((input, ctx) => { const ids = input.entries.map(entry => "itemId" in entry ? entry.itemId : entry.heldStockId); if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Choose each item only once." }); });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function entryRequestId(batchId: string, key: string) { const hex = digest([batchId, key]); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`; }
const resultSchema = z.object({ id: z.string(), deliveryId: z.string().optional() }).strict();
export async function executeHeldStockBatch(holderUserId: string, actorUserId: string, cleanerScope: boolean, raw: unknown) {
  const input = heldStockBatchSchema.parse(raw);
  const batchId = `held_batch_${digest([holderUserId, actorUserId, input.requestId])}`;
  const payload = JSON.stringify(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${batchId}))`;
    if (input.action === "DELIVER") {
      const property = await tx.property.findFirst({ where: { id: input.propertyId, ...(cleanerScope ? accessiblePropertyWhereForCleaner(holderUserId) : { isActive: true }) }, select: { id: true } });
      if (!property) throw new HeldStockEntryError(403, "This delivery property is not available to you.");
    }
    const previous = await tx.auditLog.findUnique({ where: { id: batchId } });
    if (previous) {
      const saved = z.object({ payload: z.string(), results: z.array(resultSchema) }).strict().safeParse(previous.after);
      if (!saved.success || saved.data.payload !== payload) throw new HeldStockEntryError(409, "This batch request already recorded different details. Retry the original batch.");
      return { batchId, results: saved.data.results };
    }
    const results: z.infer<typeof resultSchema>[] = [];
    if (input.action === "RECORD") {
      for (const entry of [...input.entries].sort((a,b) => a.itemId.localeCompare(b.itemId))) {
        const recorded = await recordOwnHeldStock(holderUserId, { ...entry, requestId: entryRequestId(batchId, entry.itemId) }, actorUserId, tx);
        results.push({ id: recorded.id });
      }
    } else {
      // Lock all holdings, then source runs, then update property stock in item
      // order; single deliveries use the same holding -> run -> stock order.
      const holdings = [];
      for (const entry of [...input.entries].sort((a,b) => a.heldStockId.localeCompare(b.heldStockId))) {
        await tx.$queryRaw`SELECT "id" FROM "HeldStock" WHERE "id" = ${entry.heldStockId} FOR UPDATE`;
        const held = await tx.heldStock.findUnique({ where: { id: entry.heldStockId }, include: { shoppingRunLine: { select: { shoppingRunId: true } } } });
        if (!held || held.holderUserId !== holderUserId) throw new HeldStockEntryError(403, "This stock is not on hand with you.");
        holdings.push({ ...entry, itemId: held.itemId, runId: held.shoppingRunLine?.shoppingRunId });
      }
      const runs = Array.from(new Set(holdings.map(row => row.runId).filter((id): id is string => Boolean(id)))).sort();
      for (const id of runs) await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${id} FOR UPDATE`;
      for (const entry of holdings.sort((a,b) => a.itemId.localeCompare(b.itemId) || a.heldStockId.localeCompare(b.heldStockId))) {
        const delivery = await deliverHeldStock({ heldStockId: entry.heldStockId, propertyId: input.propertyId, quantity: entry.quantity, deliveredById: actorUserId, requireHolderUserId: holderUserId, requestId: entryRequestId(batchId, entry.heldStockId) }, tx);
        results.push({ id: entry.heldStockId, deliveryId: delivery.id });
      }
    }
    await tx.auditLog.create({ data: { id: batchId, userId: actorUserId, action: "HELD_STOCK_BATCH", entity: "HeldStock", entityId: batchId, after: { payload, results } } });
    return { batchId, results };
  }, { timeout: 30000 });
}
