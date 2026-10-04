import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export const DISPATCH_RECEIPT_PREFIX = "notificationDispatch:";
type DispatchIdentity = { event: string; day: string; recipientId: string; jobId?: string };
/**
 * A committed unique receipt serializes legacy multi-channel dispatch attempts.
 * The receipt is an attempt, never proof of delivery. Crashes/errors are not
 * automatically retried because some channels may already have accepted sends.
 */
export async function dispatchNotificationOnce(identity: DispatchIdentity, send: () => Promise<void>, now = new Date()) {
  const key = DISPATCH_RECEIPT_PREFIX + createHash("sha256").update(JSON.stringify([identity.event, identity.day, identity.recipientId, identity.jobId ?? null])).digest("hex");
  const receipt = { ...identity, status: "PROCESSING", startedAt: now.toISOString() };
  try {
    await db.appSetting.create({ data: { key, value: receipt } });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return false;
    throw error;
  }
  try {
    await send();
    await db.appSetting.update({ where: { key }, data: { value: { ...receipt, status: "ATTEMPTED", finishedAt: new Date().toISOString() } } });
  } catch (error) {
    // Do not delete the claim or retry a partially delivered multi-channel send.
    await db.appSetting.update({ where: { key }, data: { value: { ...receipt, status: "UNCERTAIN", finishedAt: new Date().toISOString() } } }).catch(() => undefined);
    throw error;
  }
  return true;
}
