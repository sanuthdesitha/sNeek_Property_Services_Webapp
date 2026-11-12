/**
 * "Message team" on a job (owner decision 2026-11-13): pure rules shared by
 * the route, the server send and the dialog. Plain module.
 *
 * - Recipients are ONLY the cleaners currently assigned to the job (scope
 *   JOB_ASSIGNED_CLEANER, re-checked when queued and at dispatch). The office
 *   may remove names; it can never add one.
 * - Transports are explicit: Inbox (the inbox row alone), Push (the inbox row
 *   with phone and browser push) and SMS (to the cleaner's own number). Each
 *   is offered or refused with its reason.
 * - Results are what each transport answered: accepted, skipped or failed.
 *   Nothing here ever says "delivered".
 */
import type { TransportOption } from "@/lib/workforce/document-request-transports";
import { NO_TEAM_REASON } from "@/lib/jobs/job-page/primary-action";

export const JOB_OFFICE_MESSAGE_TYPE = "job.office_message";
export const JOB_OFFICE_MESSAGE_AUDIT_ACTION = "JOB_OFFICE_MESSAGE_SENT";

export const JOB_MESSAGE_TRANSPORTS = ["INBOX", "PUSH", "SMS"] as const;
export type JobMessageTransport = (typeof JOB_MESSAGE_TRANSPORTS)[number];

export const JOB_MESSAGE_TRANSPORT_LABEL: Record<JobMessageTransport, string> = { INBOX: "Inbox", PUSH: "Push", SMS: "SMS" };
export const JOB_MESSAGE_TRANSPORT_DETAIL: Record<JobMessageTransport, string> = {
  INBOX: "In the cleaner's app inbox, linked to this job (no phone alert)",
  PUSH: "Inbox notice with a phone and browser alert",
  SMS: "A text to the phone number on their account",
};

export const JOB_MESSAGE_BODY_MAX = 600;
export const JOB_MESSAGE_TITLE_MAX = 120;
/** Office-wide limits, like the other office sends: per sender per hour, per job per day. */
export const JOB_MESSAGE_SENDER_HOURLY_LIMIT = 30;
export const JOB_MESSAGE_JOB_DAILY_LIMIT = 12;

export { NO_TEAM_REASON };

export type JobMessageRecipient = { id: string; name: string; hasPhone: boolean };

export type JobMessageTransportInput = {
  recipients: readonly JobMessageRecipient[];
  /** Transports switched off for job.office_message in Notifications (catalog names). */
  switchedOff: readonly string[];
  sms: { available: boolean; reason: string | null };
};

const SWITCHED_OFF = "Switched off for Message team in Notifications.";

/** What each transport can do for this team (SMS: at least one cleaner with a phone). */
export function jobMessageTransportOptions(input: JobMessageTransportInput): Record<JobMessageTransport, TransportOption> {
  if (input.recipients.length === 0) {
    const none: TransportOption = { available: false, reason: NO_TEAM_REASON };
    return { INBOX: none, PUSH: none, SMS: none };
  }
  const inboxOff = input.switchedOff.includes("INBOX");
  const inbox: TransportOption = inboxOff ? { available: false, reason: SWITCHED_OFF } : { available: true, reason: null };
  const pushOff = input.switchedOff.includes("MOBILE_PUSH") && input.switchedOff.includes("WEB_PUSH");
  const push: TransportOption = inboxOff || pushOff ? { available: false, reason: SWITCHED_OFF } : { available: true, reason: null };
  const withPhone = input.recipients.filter((recipient) => recipient.hasPhone).length;
  const sms: TransportOption = input.switchedOff.includes("SMS")
    ? { available: false, reason: SWITCHED_OFF }
    : !input.sms.available
      ? { available: false, reason: input.sms.reason ?? "SMS is not configured." }
      : withPhone === 0
        ? { available: false, reason: "No assigned cleaner has a phone number recorded." }
        : { available: true, reason: null };
  return { INBOX: inbox, PUSH: push, SMS: sms };
}

/** Push includes the inbox row, so both ticked sends Push once. */
export function normalizeJobTransports(transports: readonly JobMessageTransport[]): JobMessageTransport[] {
  const set = new Set(transports);
  if (set.has("PUSH")) set.delete("INBOX");
  return JOB_MESSAGE_TRANSPORTS.filter((transport) => set.has(transport));
}

/** The truthful per-recipient, per-transport answer shown after a send. */
export type JobMessageOutcomeState = "accepted" | "skipped" | "failed";

export type JobMessageOutcome = {
  userId: string;
  name: string;
  transport: "INBOX" | "MOBILE_PUSH" | "WEB_PUSH" | "SMS";
  state: JobMessageOutcomeState;
  /** Why it was skipped or failed, in plain words; null when accepted. */
  reason: string | null;
};

const REASON_TEXT: Record<string, string> = {
  recipient_not_in_scope: "No longer assigned to this job.",
  recipient_unavailable: "Account not active.",
  no_browser_subscription: "No browser alerts set up.",
  missing_phone: "No phone number recorded.",
  switched_off: "Switched off in Notifications.",
  recipient_preference: "Their own notification choices.",
  provider_outcome_unknown: "The provider's answer was not confirmed.",
};

/** Map a pipeline or provider state to the three words the office sees. */
export function outcomeState(state: string): JobMessageOutcomeState {
  if (["queued", "inbox_available", "provider_accepted", "requested", "already_requested"].includes(state)) return "accepted";
  if (state === "skipped" || state === "switched_off") return "skipped";
  return "failed";
}

export function outcomeReason(state: string, errorCode: string | null | undefined): string | null {
  if (outcomeState(state) === "accepted") return null;
  if (state === "switched_off") return REASON_TEXT.switched_off;
  if (errorCode && REASON_TEXT[errorCode]) return REASON_TEXT[errorCode];
  if (errorCode?.startsWith("sms_")) return `SMS provider answered: ${errorCode.slice(4)}.`;
  return errorCode ? errorCode.replace(/_/g, " ") : null;
}

export const JOB_MESSAGE_STATE_LABEL: Record<JobMessageOutcomeState, string> = {
  accepted: "Accepted (not proof it was read)",
  skipped: "Skipped",
  failed: "Failed",
};
