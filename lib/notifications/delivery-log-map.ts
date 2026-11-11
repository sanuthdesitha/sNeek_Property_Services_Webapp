/**
 * Pure read model for the unified delivery log: one row shape for pipeline
 * intents, legacy Notification rows and template-engine log rows, with a
 * truthful state vocabulary and redaction. No database access here.
 */
import { catalogEntryForEventKey, catalogEntryForSubject } from "./catalog";
import type { NotificationTransport } from "./catalog-types";

export const DELIVERY_STATES = [
  "queued", "retry_wait", "processing", "inbox_available", "provider_accepted",
  "delivered", "opened", "bounced", "sent_recorded", "failed", "uncertain", "skipped",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = {
  queued: "Queued",
  retry_wait: "Waiting to retry",
  processing: "Sending",
  inbox_available: "In inbox",
  provider_accepted: "Accepted by provider",
  delivered: "Provider reported delivered",
  opened: "Provider reported opened",
  bounced: "Bounced",
  sent_recorded: "Sent (no provider evidence)",
  failed: "Failed",
  uncertain: "Outcome unknown",
  skipped: "Skipped",
};

export type DeliverySource = "intent" | "notification" | "template_log";

export type DeliveryLogRow = {
  /** Source-prefixed id: `intent:<id>`, `notification:<id>`, `log:<id>`. */
  id: string;
  source: DeliverySource;
  typeKey: string | null;
  typeName: string;
  recipientId: string | null;
  recipientLabel: string;
  transport: NotificationTransport;
  /** Phone push state for inbox rows that carry the mobile outbox marker. */
  phonePush: string | null;
  path: "pipeline" | "direct";
  state: DeliveryState;
  stateLabel: string;
  time: string;
  error: string | null;
  subject: string;
  related: { href: string; label: string } | null;
  /** A safe retry the existing review endpoint supports, if any. */
  retry: { intentId: string; updatedAt: string; action: "RETRY_KNOWN_REJECTION" | "RECONCILE_INBOX" } | null;
};

// A keyword, a short gap without digits (e.g. " code: "), then a token holding a digit.
const SENSITIVE_CODE = /\b(code|pin|passcode|lockbox|lock box|key ?safe|keysafe|gate|alarm|access)\b([^0-9\n]{0,15}?)([A-Za-z#*-]*\d[A-Za-z0-9#*-]*)/gi;
const SENSITIVE_PASSWORD = /\b(password|passcode|pwd)\b(\s*[:=]?\s*)(\S+)/gi;

/**
 * Masks what looks like an access code, PIN or password after its keyword and
 * strips query strings from links (tokens). Applied to every subject and
 * preview the log returns; message bodies are never returned in full.
 */
export function redactSensitiveText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(SENSITIVE_PASSWORD, (_match, word: string, gap: string) => `${word}${gap}•••`)
    .replace(SENSITIVE_CODE, (_match, word: string, gap: string) => `${word}${gap}•••`)
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, "$1?…");
}

export function intentState(status: string, transport: string): DeliveryState {
  switch (status) {
    case "QUEUED": return "queued";
    case "RETRY_WAIT": return "retry_wait";
    case "PROCESSING": return "processing";
    case "ACCEPTED": return transport === "INBOX" ? "inbox_available" : "provider_accepted";
    case "FAILED": return "failed";
    case "SKIPPED": return "skipped";
    default: return "uncertain";
  }
}

export function notificationState(row: { channel: string; status: string; deliveryStatus: string | null; externalId: string | null }): DeliveryState {
  if (row.status === "PENDING") return "queued";
  if (row.status === "FAILED") return "failed";
  if (row.status !== "SENT") return "uncertain";
  if (row.channel === "PUSH") return "inbox_available";
  if (row.deliveryStatus === "DELIVERED") return "delivered";
  if (row.deliveryStatus === "OPENED") return "opened";
  if (row.deliveryStatus === "BOUNCED") return "bounced";
  return row.externalId ? "provider_accepted" : "sent_recorded";
}

export function templateLogState(status: string): DeliveryState {
  if (status === "SENT") return "sent_recorded";
  if (status === "FAILED") return "failed";
  if (status === "SKIPPED") return "skipped";
  return "uncertain";
}

const INTENT_TRANSPORT: Record<string, NotificationTransport> = { INBOX: "INBOX", EMAIL: "EMAIL", SMS: "SMS", WEB_PUSH: "WEB_PUSH" };
const CHANNEL_TRANSPORT: Record<string, NotificationTransport> = { PUSH: "INBOX", EMAIL: "EMAIL", SMS: "SMS" };

export type IntentRowInput = {
  id: string; eventKey: string; recipientId: string; transport: string; status: string; updatedAt: Date; createdAt: Date;
  lastErrorCode: string | null; attemptCount: number; lastAttemptStatus: string | null; subject: string | null; jobId: string | null;
};

export function intentRow(row: IntentRowInput, recipientLabel: string): DeliveryLogRow {
  const type = catalogEntryForEventKey(row.eventKey);
  const state = intentState(row.status, row.transport);
  const retryable = row.status === "FAILED" && row.lastAttemptStatus === "NOT_ACCEPTED" && row.attemptCount < 5;
  const reconcilable = row.transport === "INBOX" && (row.status === "FAILED" || row.status === "UNCERTAIN");
  return {
    id: `intent:${row.id}`, source: "intent", typeKey: type?.key ?? null, typeName: type?.name ?? row.eventKey,
    recipientId: row.recipientId, recipientLabel, transport: INTENT_TRANSPORT[row.transport] ?? "INBOX", phonePush: null,
    path: "pipeline", state, stateLabel: DELIVERY_STATE_LABEL[state], time: row.createdAt.toISOString(), error: row.lastErrorCode,
    subject: redactSensitiveText(row.subject) || row.eventKey,
    related: row.jobId ? { href: `/v2/admin/jobs/${row.jobId}`, label: "Job" } : null,
    retry: retryable ? { intentId: row.id, updatedAt: row.updatedAt.toISOString(), action: "RETRY_KNOWN_REJECTION" }
      : reconcilable ? { intentId: row.id, updatedAt: row.updatedAt.toISOString(), action: "RECONCILE_INBOX" } : null,
  };
}

export type NotificationRowInput = {
  id: string; userId: string | null; jobId: string | null; channel: string; status: string; subject: string | null;
  errorMsg: string | null; externalId: string | null; deliveryStatus: string | null; createdAt: Date;
};

export function notificationRow(row: NotificationRowInput, recipientLabel: string): DeliveryLogRow {
  const type = catalogEntryForSubject(row.subject);
  const state = notificationState(row);
  const marker = row.channel === "PUSH" && row.externalId?.startsWith("mobile-outbox:") ? row.externalId.replace("mobile-outbox:", "") : null;
  return {
    id: `notification:${row.id}`, source: "notification", typeKey: type?.key ?? null, typeName: type?.name ?? "Unclassified (legacy row)",
    recipientId: row.userId, recipientLabel, transport: CHANNEL_TRANSPORT[row.channel] ?? "INBOX",
    phonePush: marker ? (marker.startsWith("pending") ? "queued" : marker.startsWith("claimed") ? "sending" : marker.toLowerCase()) : null,
    // Rows created by a pipeline INBOX intent carry its id.
    path: row.id.startsWith("intent-") ? "pipeline" : "direct",
    state, stateLabel: DELIVERY_STATE_LABEL[state], time: row.createdAt.toISOString(), error: redactSensitiveText(row.errorMsg) || null,
    subject: redactSensitiveText(row.subject) || "Notification",
    related: row.jobId ? { href: `/v2/admin/jobs/${row.jobId}`, label: "Job" } : null,
    retry: null,
  };
}

export type TemplateLogRowInput = {
  id: string; eventKey: string; recipientEmail: string | null; recipientRole: string; channel: string; status: string;
  subject: string | null; error: string | null; createdAt: Date;
};

const PROVIDER_EVENT_STATE: Record<string, DeliveryState> = { "email.delivered": "delivered", "email.opened": "opened", "email.bounced": "bounced", "email.complained": "bounced" };

/** NotificationLog holds finance-template sends and the email provider's webhook events. */
export function templateLogRow(row: TemplateLogRowInput): DeliveryLogRow {
  const providerEvent = row.eventKey.startsWith("email.");
  const state = (providerEvent ? PROVIDER_EVENT_STATE[row.eventKey] : undefined) ?? templateLogState(row.status);
  return {
    id: `log:${row.id}`, source: "template_log", typeKey: providerEvent ? null : "money.finance_events",
    typeName: providerEvent ? `Email provider event: ${row.eventKey}` : `Template event: ${row.eventKey}`,
    recipientId: null, recipientLabel: row.recipientEmail ?? row.recipientRole, transport: CHANNEL_TRANSPORT[row.channel] ?? "EMAIL", phonePush: null,
    path: "direct", state, stateLabel: DELIVERY_STATE_LABEL[state], time: row.createdAt.toISOString(), error: redactSensitiveText(row.error) || null,
    subject: redactSensitiveText(row.subject) || row.eventKey, related: null, retry: null,
  };
}

/** Merge already time-sorted prefixes from each source into one page. */
export function mergePage(sources: DeliveryLogRow[][], dir: "asc" | "desc", skip: number, take: number): DeliveryLogRow[] {
  const all = sources.flat().sort((a, b) => {
    const diff = Date.parse(a.time) - Date.parse(b.time);
    return (dir === "asc" ? diff : -diff) || a.id.localeCompare(b.id);
  });
  return all.slice(skip, skip + take);
}
