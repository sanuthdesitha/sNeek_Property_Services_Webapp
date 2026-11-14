/**
 * Catalog entry for the sending safeguards' own notices (2026-11-15). Data
 * only, like the other catalog files.
 */
import type { NotificationTypeEntry } from "./catalog-types";

export const SAFEGUARD_NOTIFICATION_TYPES: readonly NotificationTypeEntry[] = [
  {
    key: "system.sending_safeguard",
    name: "Sending safeguards",
    group: "Office alerts",
    trigger: "The sending circuit breaker pauses a notification type, a person or a job (too many messages in a short window), a scheduled job keeps failing, or (daily) something was not sent the day before. Also releases messages held over quiet hours, once.",
    audience: "Active administrators (scope STAFF_MEMBER per administrator).",
    audienceKeys: ["STAFF_ADMIN"],
    initiator: "AUTOMATIC",
    transports: ["INBOX", "EMAIL"],
    defaultTransports: ["INBOX", "EMAIL"],
    path: "PIPELINE_WITH_FALLBACK",
    eventKeys: ["system.sending_safeguard"],
    switches: [{ kind: "TYPE_CONTROL" }],
    template: { kind: "NONE" },
    preferences: "IGNORES",
    producers: ["lib/notifications/safeguards/alerts.ts", "lib/notifications/safeguards/held.ts"],
    notes: "One inbox notice and at most one email per incident (event id), and at most the configured number of safeguard emails per hour in total, so the alert cannot loop. The daily line is inbox only. Held messages keep their own type when released.",
  },
];
