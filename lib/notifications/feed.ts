import { type Notification, Role } from "@prisma/client";
import { resolveAdminNotificationHref } from "@/lib/notifications/navigation";

export type NotificationFeedItem = {
  id: string;
  userId: string | null;
  jobId: string | null;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  href: string;
};

export function notificationWhereForRole(role: Role, userId: string) {
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) {
    return {};
  }
  return { userId };
}

export function resolveNotificationHrefForRole(notification: Pick<Notification, "jobId" | "subject" | "body">, role: Role) {
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) {
    return resolveAdminNotificationHref(notification);
  }
  if (notification.jobId) {
    if (role === Role.CLEANER) return `/cleaner/jobs/${notification.jobId}`;
    if (role === Role.CLIENT) return "/client";
    if (role === Role.LAUNDRY) return "/laundry";
  }
  if (role === Role.CLEANER) return "/cleaner";
  if (role === Role.CLIENT) return "/client";
  if (role === Role.LAUNDRY) return "/laundry";
  return "/admin/notifications";
}

export function toNotificationFeedItem(notification: Notification, role: Role): NotificationFeedItem {
  return {
    id: notification.id,
    userId: notification.userId ?? null,
    jobId: notification.jobId ?? null,
    channel: String(notification.channel),
    subject: notification.subject ?? null,
    body: notification.body,
    status: String(notification.status),
    createdAt: notification.createdAt.toISOString(),
    sentAt: notification.sentAt ? notification.sentAt.toISOString() : null,
    href: resolveNotificationHrefForRole(notification, role),
  };
}
