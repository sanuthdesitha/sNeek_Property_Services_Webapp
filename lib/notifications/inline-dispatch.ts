import "server-only";
import { db } from "@/lib/db";
import { claimNotificationIntent, deliverInboxIntent, reconcileInboxFailure } from "./intent-store";

/**
 * Deliver freshly committed INBOX intents now, instead of waiting for the
 * five-minute pipeline worker, so an office-initiated message appears in the
 * recipient's inbox (and its phone push is queued) as promptly as the legacy
 * direct insert did.
 *
 * Uses exactly the worker's claim / deliver / reconcile steps, so the lease,
 * the attempt ledger and the recipient re-authorization are the same. An
 * intent that cannot be claimed or delivered here is left for the worker; it
 * is reported as still queued, never as delivered.
 */
export type InlineInboxState =
  | { state: "inbox_available"; notificationId: string | null }
  | { state: "skipped"; errorCode: string | null }
  | { state: "queued"; errorCode: string | null };

export async function deliverInboxIntentsNow(intentIds: string[]): Promise<Map<string, InlineInboxState>> {
  const results = new Map<string, InlineInboxState>();
  for (const id of intentIds) {
    try {
      const claimed = await claimNotificationIntent(id, new Date());
      if (claimed?.leaseToken) {
        try {
          await deliverInboxIntent(id, claimed.leaseToken, new Date());
        } catch {
          // Same recovery as the worker: only a proven rollback becomes retryable.
          await reconcileInboxFailure(id, claimed.leaseToken, new Date()).catch(() => undefined);
        }
      }
    } catch {
      // A failed claim has not delivered anything; the worker will pick it up.
    }
    results.set(id, await readInboxState(id));
  }
  return results;
}

async function readInboxState(id: string): Promise<InlineInboxState> {
  const intent = await db.notificationIntent.findUnique({
    where: { id },
    select: { status: true, lastErrorCode: true, notificationId: true },
  });
  if (intent?.status === "ACCEPTED") return { state: "inbox_available", notificationId: intent.notificationId };
  if (intent?.status === "SKIPPED") return { state: "skipped", errorCode: intent.lastErrorCode };
  return { state: "queued", errorCode: intent?.lastErrorCode ?? null };
}
