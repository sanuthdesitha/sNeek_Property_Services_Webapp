import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export const DISPATCH_RECEIPT_PREFIX = "notificationDispatch:";
type DispatchIdentity = { event: string; day: string; recipientId: string; jobId?: string };

/** A committed claim on one dispatch attempt (see claimNotificationDispatch). */
export type DispatchClaim = {
  key: string;
  receipt: DispatchIdentity & { status: "PROCESSING"; startedAt: string };
};

function receiptKey(identity: DispatchIdentity): string {
  return DISPATCH_RECEIPT_PREFIX + createHash("sha256").update(JSON.stringify([identity.event, identity.day, identity.recipientId, identity.jobId ?? null])).digest("hex");
}

/**
 * Commit the unique receipt for one attempt before anything is sent. Null when
 * another run already holds it (that attempt is never repeated). Any other
 * database error is thrown, so nothing is sent without a committed claim.
 */
export async function claimNotificationDispatch(identity: DispatchIdentity, now = new Date()): Promise<DispatchClaim | null> {
  const key = receiptKey(identity);
  const receipt = { ...identity, status: "PROCESSING" as const, startedAt: now.toISOString() };
  try {
    await db.appSetting.create({ data: { key, value: receipt } });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return null;
    throw error;
  }
  return { key, receipt };
}

/**
 * Record how a claimed attempt ended: ATTEMPTED after the sends returned,
 * UNCERTAIN when they threw (some channels may already have accepted). An
 * UNCERTAIN update that itself fails leaves the claim PROCESSING; either way
 * the claim is kept and the attempt is not retried automatically.
 */
export async function finishNotificationDispatch(claim: DispatchClaim, status: "ATTEMPTED" | "UNCERTAIN"): Promise<void> {
  const value = { ...claim.receipt, status, finishedAt: new Date().toISOString() };
  if (status === "ATTEMPTED") {
    await db.appSetting.update({ where: { key: claim.key }, data: { value } });
    return;
  }
  await db.appSetting.update({ where: { key: claim.key }, data: { value } }).catch(() => undefined);
}

/**
 * A committed unique receipt serializes legacy multi-channel dispatch attempts.
 * The receipt is an attempt, never proof of delivery. Crashes/errors are not
 * automatically retried because some channels may already have accepted sends.
 */
export async function dispatchNotificationOnce(identity: DispatchIdentity, send: () => Promise<void>, now = new Date()) {
  const claim = await claimNotificationDispatch(identity, now);
  if (!claim) return false;
  try {
    await send();
    await finishNotificationDispatch(claim, "ATTEMPTED");
  } catch (error) {
    // Do not delete the claim or retry a partially delivered multi-channel send.
    await finishNotificationDispatch(claim, "UNCERTAIN");
    throw error;
  }
  return true;
}
