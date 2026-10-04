import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/settings";
import { deliverMobilePushNotification } from "./mobile-push";
import { MOBILE_PENDING, MOBILE_CLAIMED, MOBILE_PREFIX, MOBILE_REVIEW_REQUIRED } from "./mobile-outbox-marker";

/** Never scans historic unmarked rows or invokes a provider within a transaction. */
export async function dispatchMobileOutbox(now = new Date()) {
  const startedAt = Date.now();
  const stale = await db.notification.findMany({
    where: { channel: "PUSH", externalId: { startsWith: MOBILE_CLAIMED } },
    select: { id: true, externalId: true }, take: 100,
  });
  for (const row of stale) {
    const claimedAt = Number(row.externalId?.slice(MOBILE_CLAIMED.length).split(":")[0]);
    if (Number.isFinite(claimedAt) && claimedAt + 120_000 <= now.getTime()) {
      await db.notification.updateMany({ where: { id: row.id, externalId: row.externalId }, data: { externalId: `${MOBILE_PREFIX}UNCERTAIN` } });
    }
  }
  const due = await db.notification.findMany({
    where: { channel: "PUSH", status: "SENT", externalId: { startsWith: MOBILE_PENDING } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50,
  });
  for (const notification of due) {
    const marker = notification.externalId!;
    const categoryName = marker.slice(MOBILE_PENDING.length + 1);
    const category = NOTIFICATION_CATEGORIES.includes(categoryName as NotificationCategory) ? categoryName as NotificationCategory : undefined;
    if (!category) {
      await db.notification.updateMany({ where: { id: notification.id, externalId: marker }, data: {
        externalId: MOBILE_REVIEW_REQUIRED, errorMsg: "Mobile push needs review: missing or invalid notification category.",
      } });
      continue;
    }
    const lease = `${MOBILE_CLAIMED}${now.getTime() + Date.now() - startedAt}:${randomUUID()}`;
    const claimed = await db.notification.updateMany({
      where: { id: notification.id, externalId: marker, channel: "PUSH", status: "SENT" }, data: { externalId: lease },
    });
    if (!claimed.count) continue;
    // Another connection can see this row only after the producer's commit.
    // Failure after provider call retains the lease for UNCERTAIN reconciliation.
    const outcome = await deliverMobilePushNotification(db as any, notification, category);
    await db.notification.updateMany({ where: { id: notification.id, externalId: lease }, data: { externalId: `${MOBILE_PREFIX}${outcome}` } });
  }
}
