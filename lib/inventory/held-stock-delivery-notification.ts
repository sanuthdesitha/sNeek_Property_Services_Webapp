import { db } from "@/lib/db";
import { notifyClientsShoppingCompleted } from "./client-shopping-notifications";
/** Runs after the delivery transaction; mail cannot turn saved stock into a failed write. */
export async function notifyHeldStockDelivery(heldStockId: string, deliveryId: string) {
  try {
    const holding = await db.heldStock.findUnique({ where: { id: heldStockId }, select: { shoppingRunId: true, shoppingRunLine: { select: { propertyId: true } } } });
    if (!holding?.shoppingRunId || !holding.shoppingRunLine || holding.shoppingRunLine.propertyId) return undefined;
    const result = await notifyClientsShoppingCompleted(holding.shoppingRunId, { deliveryId });
    return result.unconfirmed ? "Stock was delivered, but the client email was not confirmed. The office can review notification history." : undefined;
  } catch { return "Stock was delivered, but the client email was not confirmed. The office can review notification history."; }
}
