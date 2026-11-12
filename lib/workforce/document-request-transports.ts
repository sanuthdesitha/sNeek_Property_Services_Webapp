/**
 * Which transports a document request (Accounts "Request document", Command
 * "Send reminder") can use for one person, and why not. Pure and client-safe:
 * the server builds it (`document-request-options.ts`) and the dialogs show it.
 *
 * "PUSH" is the in-app inbox notice with its phone and browser push; it is
 * offered whenever the account is active and the type's inbox is not switched
 * off. Email and SMS need the person's own address / number and a configured
 * provider. Nothing here is a delivery promise: the send returns each
 * transport's real state.
 */
export const REQUEST_TRANSPORTS = ["PUSH", "EMAIL", "SMS"] as const;
export type RequestTransport = (typeof REQUEST_TRANSPORTS)[number];

export const REQUEST_TRANSPORT_LABEL: Record<RequestTransport, string> = {
  PUSH: "Inbox",
  EMAIL: "Email",
  SMS: "SMS",
};

export const REQUEST_TRANSPORT_DETAIL: Record<RequestTransport, string> = {
  PUSH: "In-app notice with phone and browser push",
  EMAIL: "To the email address on their account",
  SMS: "To the phone number on their account",
};

export type TransportOption = { available: boolean; reason: string | null };
export type TransportOptions = Record<RequestTransport, TransportOption>;

/** A saved "Don't ask again" choice of the office user (never of the recipient). */
export type SavedTransportChoiceView = { transports: RequestTransport[]; savedAt: string };

export type DocumentRequestPerson = {
  id: string;
  name: string;
  hasEmail: boolean;
  hasPhone: boolean;
  active: boolean;
};

/** What a dialog needs to offer the choice. */
export type DocumentRequestOptions = {
  person: DocumentRequestPerson;
  transports: TransportOptions;
  /** The office user's saved choice, or null (none, or unreadable). */
  saved: SavedTransportChoiceView | null;
  /** False when a saved choice exists but could not be read: the dialog asks. */
  savedReadable: boolean;
  /** Messages are refused while impersonating; the dialog says so. */
  impersonating: boolean;
};

export type ProviderState = { available: boolean; reason: string | null };

export type TransportOptionsInput = {
  hasEmail: boolean;
  hasPhone: boolean;
  active: boolean;
  /** Transports switched off for `workforce.document_request` in Notifications. */
  switchedOff: readonly string[];
  providers: { EMAIL: ProviderState; SMS: ProviderState };
};

const SWITCHED_OFF = "Switched off for document requests in Notifications.";

export function documentRequestTransportOptions(input: TransportOptionsInput): TransportOptions {
  if (!input.active) {
    const inactive: TransportOption = { available: false, reason: "This account is not active." };
    return { PUSH: inactive, EMAIL: inactive, SMS: inactive };
  }
  const push: TransportOption = input.switchedOff.includes("INBOX")
    ? { available: false, reason: SWITCHED_OFF }
    : { available: true, reason: null };
  const email: TransportOption = !input.hasEmail
    ? { available: false, reason: "No email address recorded." }
    : input.switchedOff.includes("EMAIL")
      ? { available: false, reason: SWITCHED_OFF }
      : input.providers.EMAIL.available
        ? { available: true, reason: null }
        : { available: false, reason: input.providers.EMAIL.reason ?? "Email is not configured." };
  const sms: TransportOption = !input.hasPhone
    ? { available: false, reason: "No phone number recorded." }
    : input.providers.SMS.available
      ? { available: true, reason: null }
      : { available: false, reason: input.providers.SMS.reason ?? "SMS is not configured." };
  return { PUSH: push, EMAIL: email, SMS: sms };
}

/** The saved transports that can be used for this person, in display order. */
export function usableSavedTransports(saved: SavedTransportChoiceView | null, options: TransportOptions): RequestTransport[] {
  if (!saved) return [];
  return REQUEST_TRANSPORTS.filter((transport) => saved.transports.includes(transport) && options[transport].available);
}

/** "Inbox, Email" — the visible "Sending by" line. */
export function transportList(transports: readonly RequestTransport[]): string {
  return REQUEST_TRANSPORTS.filter((transport) => transports.includes(transport)).map((transport) => REQUEST_TRANSPORT_LABEL[transport]).join(", ");
}
