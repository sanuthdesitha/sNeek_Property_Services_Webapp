/**
 * Types for the notification catalog (`lib/notifications/catalog.ts`).
 *
 * Dependency-free on purpose: the catalog is read by the notifications screen,
 * the server routes and a static-analysis test, so it must not pull in the
 * database or provider clients.
 */
import type { EmailAutoKind } from "./email-kinds";
import type { NotificationAudience } from "./audience-controls";

/**
 * How a message can reach a person.
 * - INBOX: a row in the person's in-app notification list.
 * - MOBILE_PUSH: an Expo push to the phone app, sent by the mobile outbox
 *   worker for an inbox row that carries the `mobile-outbox:pending` marker.
 * - WEB_PUSH: a browser / installed-PWA push to a stored subscription.
 * - EMAIL / SMS: the email (Resend) and SMS (Twilio or Cellcast) providers.
 */
export const NOTIFICATION_TRANSPORTS = ["INBOX", "MOBILE_PUSH", "WEB_PUSH", "EMAIL", "SMS"] as const;
export type NotificationTransport = (typeof NOTIFICATION_TRANSPORTS)[number];

export const TRANSPORT_LABEL: Record<NotificationTransport, string> = {
  INBOX: "In-app inbox",
  MOBILE_PUSH: "Phone app push",
  WEB_PUSH: "Browser push",
  EMAIL: "Email",
  SMS: "SMS",
};

/**
 * Which code path sends it.
 * - PIPELINE: queued as a durable NotificationIntent and dispatched by the worker.
 * - PIPELINE_WITH_FALLBACK: on the pipeline; an external transport whose
 *   outbox switch is off is sent directly instead (and recorded as such).
 * - DIRECT: sent inline by the producer (legacy path).
 * - NO_PRODUCER: configured, but no code sends it today.
 */
export type NotificationPath = "PIPELINE" | "PIPELINE_WITH_FALLBACK" | "DIRECT" | "NO_PRODUCER";

export const PATH_LABEL: Record<NotificationPath, string> = {
  PIPELINE: "Pipeline",
  PIPELINE_WITH_FALLBACK: "Pipeline (direct fallback)",
  DIRECT: "Direct",
  NO_PRODUCER: "Not sent today",
};

/** Who or what starts it. */
export type NotificationInitiator = "AUTOMATIC" | "SCHEDULED" | "PERSON_ACTION" | "OFFICE_MANUAL";

/**
 * Whether the recipient's own notification preferences decide delivery.
 * - RESPECTS: per-category preferences and audience channel controls apply.
 * - IGNORES: an office-directed message; only provider-level gates apply.
 * - ADMIN_SWITCH: decided by a switch in the notifications area (default shown).
 * - EMAIL_GATES_ONLY: the email chokepoint's own gates (automation kind,
 *   audience, suppression, the person's email preferences) apply; nothing else.
 */
export type PreferenceMode = "RESPECTS" | "IGNORES" | "ADMIN_SWITCH" | "EMAIL_GATES_ONLY";

/** The existing control that turns a transport of this type on or off. */
export type TransportSwitch =
  | { kind: "EMAIL_KIND"; emailKind: EmailAutoKind }
  | { kind: "SCHEDULED"; setting: "reminder24hEnabled" | "reminder2hEnabled" | "tomorrowPrepEnabled" | "stockAlertsEnabled" | "adminAttentionSummaryEnabled" }
  | { kind: "FINANCE_EVENT" }
  | { kind: "CLIENT_JOB_PREFERENCES" }
  | { kind: "TYPE_CONTROL" }
  | { kind: "SMS_PROVIDER" }
  | { kind: "NONE" };

export type TemplateRef =
  | { kind: "NONE" }
  | { kind: "EMAIL_TEMPLATE"; key: string }
  | { kind: "LIFECYCLE" }
  | { kind: "FINANCE_TEMPLATE" }
  | { kind: "MESSAGE_TEMPLATE" };

export type CatalogGroup = "Jobs" | "Cleaners" | "Clients" | "Office alerts" | "Laundry" | "Stock" | "Money" | "Accounts" | "Workforce" | "Leads & marketing";

export type NotificationTypeEntry = {
  /** Stable key; used by type controls, the delivery log and the API. Never rename. */
  key: string;
  name: string;
  group: CatalogGroup;
  /** What triggers it, in plain words. */
  trigger: string;
  /** Who receives it, in plain words. */
  audience: string;
  audienceKeys: NotificationAudience[];
  initiator: NotificationInitiator;
  /** Transports this type can use. */
  transports: NotificationTransport[];
  /** Transports used by default today (subset of `transports`). */
  defaultTransports: NotificationTransport[];
  path: NotificationPath;
  /** Pipeline event keys this type records (NotificationIntent.eventKey). */
  eventKeys?: string[];
  /** Subjects (prefix match) that identify its legacy Notification rows in the log. */
  logSubjects?: string[];
  emailKind?: EmailAutoKind;
  switches: TransportSwitch[];
  template: TemplateRef;
  preferences: PreferenceMode;
  /** Source files that send it; the static test keeps this complete. */
  producers: string[];
  /** A "send test to me" is offered (always to the signed-in admin only). */
  testable?: boolean;
  /** Honest notes: gaps, dedupe, what is not recorded. */
  notes?: string;
};
