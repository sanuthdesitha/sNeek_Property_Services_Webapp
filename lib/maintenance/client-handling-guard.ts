/**
 * The office cannot put our own people or a price on an item while the client
 * is arranging it (client-handled maintenance, 2026-11-18): the assign paths
 * and the quote call this inside their own transaction, after their lock.
 * Removing people is never refused. Small on purpose so the assign modules do
 * not pull in the notification code.
 */
import type { Prisma } from "@prisma/client";
import { isWithClient } from "@/lib/maintenance/client-handling-rules";

type Reader = Pick<Prisma.TransactionClient, "propertyMaintenanceItem">;

export const WITH_CLIENT_REFUSAL = "This item is with the client to arrange. Take it back from the client first.";

export async function assertNotWithClient(reader: Reader, itemId: string): Promise<void> {
  const item = await reader.propertyMaintenanceItem.findUnique({ where: { id: itemId }, select: { clientHandling: true } });
  if (item && isWithClient(item.clientHandling)) throw new Error(WITH_CLIENT_REFUSAL);
}
