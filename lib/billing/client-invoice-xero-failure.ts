/**
 * Recording a failed Xero push (Wave D). Before this, a failure left the
 * reservation PENDING, so "push in flight" and "push failed" could not be told
 * apart. Now the reservation becomes FAILED with the provider's reason
 * (sanitised: no tokens, bounded length) and the time, under the same row lock
 * as every invoice edit. The reservation itself is kept, so the row stays
 * locked against edits and "Retry Xero" reuses the same provider idempotency
 * key: a push Xero did accept despite the error is never created twice.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const MAX_REASON_LENGTH = 300;

/** A provider message safe to store and show: one line, no bearer tokens or long secrets, bounded. */
export function sanitiseXeroFailureReason(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  const redacted = oneLine
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  const text = redacted || "Could not push invoice to Xero.";
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text;
}

/**
 * Mark a reserved push FAILED. Only a reservation that is still open (not yet
 * exported, still PENDING) is changed: a concurrent success always wins.
 * Best-effort: a failure to record leaves the PENDING reservation, which is
 * still locked and still retryable.
 */
export async function recordXeroPushFailure(invoiceId: string, message: string, now: Date = new Date()): Promise<boolean> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
      const current = await tx.clientInvoice.findUnique({ where: { id: invoiceId }, select: { xeroInvoiceId: true, metadata: true } });
      if (!current || current.xeroInvoiceId) return false;
      const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
        ? (current.metadata as Record<string, unknown>)
        : {};
      if (metadata.xeroExportState !== "PENDING") return false;
      await tx.clientInvoice.update({
        where: { id: invoiceId },
        data: {
          metadata: {
            ...metadata,
            xeroExportState: "FAILED",
            xeroExportFailure: { reason: sanitiseXeroFailureReason(message), at: now.toISOString() },
          } as object,
        },
      });
      return true;
    });
  } catch (error) {
    logger.error({ error, invoiceId }, "[invoice] Xero push failed and the failure could not be recorded; the reservation stays pending");
    return false;
  }
}
