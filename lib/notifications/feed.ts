import { NotificationChannel, type Notification, Role } from "@prisma/client";
import { resolveAdminNotificationHref } from "@/lib/notifications/navigation";
import type { PortalVersion } from "@/lib/portal-version";

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
  isRead: boolean;
  canMarkRead: boolean;
};

export function notificationWhereForRole(role: Role, userId: string) {
  return {
    userId,
    channel: NotificationChannel.PUSH,
  };
}

const END_USER_HIDDEN_PATTERNS = [
  /\b(?:email|sms)\s+sent\s+to\b/i,
  /\btest sent to\b/i,
  /\bprovider failed\b/i,
  /\bdelivery failed\b/i,
];

export function isNotificationVisibleToRole(
  notification: Pick<Notification, "subject" | "body">,
  role: Role
) {
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) return true;
  const subject = notification.subject ?? "";
  const body = notification.body ?? "";
  return !END_USER_HIDDEN_PATTERNS.some((pattern) => pattern.test(subject) || pattern.test(body));
}

export function resolveNotificationHrefForRole(notification: Pick<Notification, "jobId" | "subject" | "body">, role: Role, version: PortalVersion = "v2") {
  const prefix = version === "v2" ? "/v2" : "";
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) {
    return `${prefix}${resolveAdminNotificationHref(notification)}`;
  }
  const jobId = notification.jobId ? encodeURIComponent(notification.jobId) : null;
  if (notification.jobId) {
    if (role === Role.CLEANER) return `${prefix}/cleaner/jobs/${jobId}`;
    if (role === Role.CLIENT || role === Role.VA) return `${prefix}/client/jobs/${jobId}`;
    if (role === Role.QA_INSPECTOR) return `${prefix}/qa/jobs/${jobId}`;
  }
  if (role === Role.CLEANER) return `${prefix}/cleaner`;
  if (role === Role.CLIENT || role === Role.VA) return `${prefix}/client`;
  if (role === Role.LAUNDRY) return `${prefix}/laundry`;
  if (role === Role.QA_INSPECTOR) return `${prefix}/qa`;
  if (role === Role.MAINTENANCE) return `${prefix}/maintenance`;
  return "/v2/login";
}

export function toNotificationFeedItem(notification: Notification, role: Role, version: PortalVersion = "v2"): NotificationFeedItem {
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
    href: resolveNotificationHrefForRole(notification, role, version),
    isRead: notification.channel === NotificationChannel.PUSH && notification.deliveryStatus === "OPENED",
    canMarkRead: notification.channel === NotificationChannel.PUSH && notification.status === "SENT"
      && (notification.deliveryStatus == null || notification.deliveryStatus === "OPENED"),
  };
}
