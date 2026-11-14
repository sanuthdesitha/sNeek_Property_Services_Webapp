/**
 * Shapes for the damage release message ("Tell the client"). Plain module,
 * safe for client components.
 */
export type DamageReleaseTransport = "INBOX" | "EMAIL" | "SMS";

/** Owner default 2026-11-14 (pending owner confirmation): inbox and email ticked, SMS off. */
export const DEFAULT_RELEASE_TRANSPORTS: readonly DamageReleaseTransport[] = ["INBOX", "EMAIL"];

export type DamageReleaseOutcome = {
  userId: string;
  name: string;
  transport: "INBOX" | "MOBILE_PUSH" | "WEB_PUSH" | "EMAIL" | "SMS";
  state: "queued" | "inbox_available" | "provider_accepted" | "requested" | "already_requested" | "uncertain" | "skipped" | "failed" | "switched_off";
  errorCode?: string | null;
};

export type DamageReleaseNoticePreview = {
  clientName: string | null;
  recipients: Array<{ id: string; name: string; hasEmail: boolean; hasPhone: boolean }>;
  /** Why no message can be sent (no client, notifications off, no login), or null. */
  refusal: string | null;
  title: string;
  body: string;
  /** Null when the SMS provider state could not be read. */
  smsConfigured: boolean | null;
  /** Transports switched off for this type in Notifications. */
  switchedOff: DamageReleaseTransport[];
};
