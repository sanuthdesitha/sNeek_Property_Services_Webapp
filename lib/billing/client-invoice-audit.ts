/**
 * One audit row on a client invoice, best effort: the action it records has
 * already happened, so a failed write is logged, never turned into a refusal.
 * Rows carry who, when (createdAt), the invoice and the outcome; never
 * credentials, recipient addresses or email bodies.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function recordInvoiceAudit(input: {
  actorId: string | null | undefined;
  invoiceId: string;
  action: string;
  after: Prisma.InputJsonObject;
}): Promise<void> {
  // AuditLog needs a user; a system-run action (no actor) is not recorded here.
  if (!input.actorId) return;
  try {
    await db.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        entity: "ClientInvoice",
        entityId: input.invoiceId,
        after: input.after,
      },
    });
  } catch (error) {
    logger.error({ error, invoiceId: input.invoiceId, action: input.action }, "[invoice] action done but its audit entry could not be written");
  }
}
