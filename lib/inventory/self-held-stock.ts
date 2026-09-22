import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";

export const selfHeldStockSchema = z.object({
  requestId: z.string().uuid(), itemId: z.string().min(1).max(200),
  quantity: z.number().finite().positive().max(1_000_000),
  sourceNote: z.string().trim().max(2000).default(""),
}).strict();
export class HeldStockEntryError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Add a newly recorded holding, never overwrite the remaining quantity after delivery. */
export async function recordOwnHeldStock(holderUserId: string, raw: unknown, actorUserId = holderUserId) {
  const input = selfHeldStockSchema.parse(raw);
  const id = `self_${createHash("sha256").update(JSON.stringify([holderUserId, actorUserId, input.requestId])).digest("hex")}`;
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const previous = await tx.heldStock.findUnique({ where: { id } });
    if (previous) {
      if (previous.holderUserId !== holderUserId || previous.itemId !== input.itemId || previous.originalQty !== input.quantity || (previous.sourceNote ?? "") !== input.sourceNote) throw new HeldStockEntryError(409, "This request already recorded different stock. Refresh before starting a new entry.");
      return { id, duplicated: true };
    }
    const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, isActive: true }, select: { id: true } });
    if (!item) throw new HeldStockEntryError(409, "This catalogue item is no longer available. Choose an active item.");
    await tx.heldStock.create({ data: { id, holderUserId, itemId: item.id, quantity: input.quantity, originalQty: input.quantity, sourceNote: input.sourceNote || null } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "HELD_STOCK_SELF_RECORDED", entity: "HeldStock", entityId: id, after: { holderUserId, itemId: item.id, quantity: input.quantity, sourceNote: input.sourceNote } } });
    return { id, duplicated: false };
  });
}

export const adjustOwnHeldStockSchema = z.object({ requestId: z.string().uuid(), heldStockId: z.string().min(1).max(200), expectedUpdatedAt: z.string().datetime(), quantity: z.number().finite().min(0).max(1_000_000), reason: z.string().trim().min(3).max(2000) }).strict();
export async function adjustOwnHeldStock(holderUserId: string, raw: unknown, actorUserId = holderUserId) {
  const input = adjustOwnHeldStockSchema.parse(raw);
  const receiptId = `held_adjust_${createHash("sha256").update(JSON.stringify([holderUserId, actorUserId, input.requestId])).digest("hex")}`;
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptId}))`;
    const previous = await tx.auditLog.findUnique({ where: { id: receiptId } });
    const after = { holderUserId, heldStockId: input.heldStockId, expectedUpdatedAt: input.expectedUpdatedAt, quantity: input.quantity, reason: input.reason };
    if (previous) {
      const saved = previous.after as Record<string, unknown> | null;
      if (!saved || Object.entries(after).some(([key, value]) => saved[key] !== value)) throw new HeldStockEntryError(409, "This adjustment request already saved different values. Refresh stock.");
      return { id: input.heldStockId, duplicated: true };
    }
    await tx.$queryRaw`SELECT "id" FROM "HeldStock" WHERE "id" = ${input.heldStockId} FOR UPDATE`;
    const held = await tx.heldStock.findUnique({ where: { id: input.heldStockId } });
    if (!held || held.holderUserId !== holderUserId) throw new HeldStockEntryError(404, "Your holding was not found.");
    if (held.status !== "HELD" || held.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new HeldStockEntryError(409, "This holding changed, possibly through a delivery. Refresh and check its current quantity before adjusting.");
    // A zero personal count is not a delivery: retain HELD and record the reason.
    await tx.heldStock.update({ where: { id: held.id }, data: { quantity: input.quantity } });
    await tx.auditLog.create({ data: { id: receiptId, userId: actorUserId, action: "HELD_STOCK_SELF_ADJUSTED", entity: "HeldStock", entityId: held.id, before: { quantity: held.quantity, updatedAt: held.updatedAt.toISOString() }, after } });
    return { id: held.id, duplicated: false };
  });
}
