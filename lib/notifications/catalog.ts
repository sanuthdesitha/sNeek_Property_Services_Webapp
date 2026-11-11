/**
 * The notification catalog: every kind of notification the system can send,
 * who receives it, by which transports, through which path, and which existing
 * switch controls it. It drives the notifications area (/v2/admin/notifications).
 *
 * Built by reading every producer (each file that calls a low-level send
 * helper). `tests/lib/notification-catalog.test.ts` scans the source tree for
 * those helper calls and fails when a file sends something no entry lists, so
 * a new notification cannot be added without a catalog entry.
 *
 * Dependency-free (data only): safe to import from client components.
 */
import { ACTION_NOTIFICATION_TYPES } from "./catalog-actions";
import { JOB_NOTIFICATION_TYPES } from "./catalog-jobs";
import { OFFICE_NOTIFICATION_TYPES } from "./catalog-office";
import { PEOPLE_NOTIFICATION_TYPES } from "./catalog-people";
import type { NotificationTypeEntry } from "./catalog-types";

export * from "./catalog-types";

export const NOTIFICATION_CATALOG: readonly NotificationTypeEntry[] = [
  ...JOB_NOTIFICATION_TYPES,
  ...OFFICE_NOTIFICATION_TYPES,
  ...PEOPLE_NOTIFICATION_TYPES,
  ...ACTION_NOTIFICATION_TYPES,
];

/**
 * The low-level send helpers. A file that calls one of these is a producer and
 * must be listed by a catalog entry. The helper modules themselves are listed
 * in `SEND_HELPER_MODULES` and are not producers on their own.
 */
export const SEND_HELPER_CALL_PATTERN =
  /\b(?:deliverNotificationToRecipients|sendEmailDetailed|sendEmail|sendSms|sendSmsDetailed|sendWebPushToUser|sendClientJobNotification|enqueueNotificationIntent|queueDelivery|notifyAdminsByPush|notifyAdminsByEmail|notifyAdminsOfNewProfile)\s*\(|\bnotification\.create(?:Many)?\s*\(/;

export const SEND_HELPER_MODULES: readonly string[] = [
  "lib/notifications/delivery.ts",
  "lib/notifications/email.ts",
  "lib/notifications/sms.ts",
  "lib/notifications/web-push.ts",
  "lib/notifications/intent-store.ts",
  "lib/notifications/intent-provider.ts",
  "lib/notifications/queue-delivery.ts",
  "lib/notifications/admin-alerts.ts",
  "lib/notifications/office-sends.ts",
];

export function catalogEntry(key: string): NotificationTypeEntry | undefined {
  return NOTIFICATION_CATALOG.find((entry) => entry.key === key);
}

/** The catalog type a pipeline event key belongs to, if any. */
export function catalogEntryForEventKey(eventKey: string): NotificationTypeEntry | undefined {
  return NOTIFICATION_CATALOG.find((entry) => entry.eventKeys?.includes(eventKey));
}

/** Best-effort type of a legacy Notification row, by its subject. Unknown stays unknown. */
export function catalogEntryForSubject(subject: string | null | undefined): NotificationTypeEntry | undefined {
  const text = (subject ?? "").trim();
  if (!text) return undefined;
  // Longest prefix wins so "Unfinished job reminder" from the manual reminder
  // and the daily nudge are told apart only where their subjects differ.
  let best: { entry: NotificationTypeEntry; length: number } | undefined;
  for (const entry of NOTIFICATION_CATALOG) {
    for (const prefix of entry.logSubjects ?? []) {
      const matches = text.startsWith(prefix) || text.includes(`: ${prefix}`);
      if (matches && (!best || prefix.length > best.length)) best = { entry, length: prefix.length };
    }
  }
  return best?.entry;
}

/** Types on the pipeline whose external transports fall back to direct when switched off. */
export function fallbackTypes() {
  return NOTIFICATION_CATALOG.filter((entry) => entry.path === "PIPELINE_WITH_FALLBACK").map((entry) => ({
    key: entry.key,
    name: entry.name,
    transports: entry.transports.flatMap((transport) =>
      transport === "EMAIL" || transport === "SMS" || transport === "WEB_PUSH" ? [transport] : [],
    ),
  }));
}

/** Link to the template editor for a type, or null when it has no editable template. */
export function catalogTemplateHref(entry: NotificationTypeEntry): string | null {
  switch (entry.template.kind) {
    case "EMAIL_TEMPLATE":
      return `/v2/admin/forms?tab=messages&view=notifications&template=${encodeURIComponent(entry.template.key)}`;
    case "MESSAGE_TEMPLATE":
      return "/v2/admin/forms?tab=messages&view=messages";
    case "LIFECYCLE":
      return "/v2/admin/forms?tab=messages&view=notifications";
    case "FINANCE_TEMPLATE":
      return "/v2/admin/notifications?tab=preferences#finance-notifications";
    default:
      return null;
  }
}
