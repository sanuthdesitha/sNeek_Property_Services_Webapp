/**
 * The portal notice a maintenance worker gets when an item is assigned to them.
 *
 * Unchanged behaviour, moved out of POST /api/admin/maintenance/[id]/assign so
 * the bulk assign answers exactly as the single assign does: a worker with a
 * portal login gets one inbox notice; a worker without a login gets nothing
 * (the office calls them). Nothing here sends email, SMS or device push.
 */
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

/** Returns true when a notice was recorded for the worker's portal login. */
export async function recordWorkerAssignedNotice(input: { itemId: string; workerId: string }): Promise<boolean> {
  const worker = await db.maintenanceWorker.findUnique({
    where: { id: input.workerId },
    select: { userId: true, name: true },
  });
  if (!worker?.userId) return false;
  const detail = await db.propertyMaintenanceItem.findUnique({
    where: { id: input.itemId },
    select: { title: true, property: { select: { name: true } } },
  });
  const notice = (await loadNotificationWording("maintenance.assignment")).render("assigned", "INBOX", {
    propertyName: detail?.property?.name ?? "A property",
    itemTitle: detail?.title ?? "Repair job",
  });
  await db.notification.create({
    data: {
      userId: worker.userId,
      externalId: mobilePendingMarker("cases"),
      channel: NotificationChannel.PUSH,
      subject: notice.title,
      body: notice.body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  });
  return true;
}
