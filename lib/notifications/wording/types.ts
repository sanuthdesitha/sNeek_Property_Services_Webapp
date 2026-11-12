/**
 * Types for the notification wording layer (2026-11 "Types and wording").
 *
 * Plain module on purpose: no "use client", no server imports. The
 * notifications screen, the API routes, the send paths and the tests all read
 * these shapes.
 */
import type { AppEmailTemplateKey } from "@/lib/email-templates";
import type { AppNotificationTemplateKey } from "@/lib/notification-templates";

/**
 * The wording transports an admin edits.
 * - INBOX: the in-app inbox row (title and body). The phone-app push is made
 *   from the inbox row, and the office-send browser push reuses it too, so a
 *   part marked `push: "SHARED"` is also the push wording.
 * - PUSH: a push composed separately from any inbox row (title and body).
 * - EMAIL: subject (plain text) and body (an HTML template; variables are
 *   HTML-escaped when rendered).
 * - SMS: one plain text body.
 */
export const WORDING_TRANSPORTS = ["INBOX", "PUSH", "EMAIL", "SMS"] as const;
export type WordingTransport = (typeof WORDING_TRANSPORTS)[number];

export const WORDING_TRANSPORT_LABEL: Record<WordingTransport, string> = {
  INBOX: "Inbox",
  PUSH: "Push",
  EMAIL: "Email",
  SMS: "SMS",
};

export type WordingField = "title" | "body" | "subject";

/** The fields each transport carries, in editor order. */
export const TRANSPORT_FIELDS: Record<WordingTransport, readonly WordingField[]> = {
  INBOX: ["title", "body"],
  PUSH: ["title", "body"],
  EMAIL: ["subject", "body"],
  SMS: ["body"],
};

export const FIELD_LABEL: Record<WordingTransport, Partial<Record<WordingField, string>>> = {
  INBOX: { title: "Inbox title", body: "Inbox body" },
  PUSH: { title: "Push title", body: "Push body" },
  EMAIL: { subject: "Email subject", body: "Email body (HTML)" },
  SMS: { body: "SMS wording" },
};

export type WordingFields = Partial<Record<WordingField, string>>;

/**
 * How a variable's value is placed into an HTML email body.
 * - text (default): HTML-escaped.
 * - multiline: HTML-escaped, then line breaks become <br>.
 * - html: a fragment this codebase built and escaped itself (never free text).
 */
export type VariableFormat = "text" | "multiline" | "html";

export type WordingVariable = {
  name: string;
  label: string;
  /** Sample value for the live preview and the test send. Never personal data. */
  sample: string;
  format?: VariableFormat;
};

/**
 * Status of a catalog type in the wording layer.
 * - EDITABLE: every message of the type renders through the wording layer.
 * - PARTS: some named parts are editable; the rest is still composed in code
 *   (the reason says which).
 * - COMPOSED: the sender writes the message (office messages, campaigns);
 *   reusable message templates live in Forms.
 * - ELSEWHERE: edited in an existing dedicated editor (linked).
 * - IN_CODE: not editable; the reason says exactly why.
 */
export type WordingStatus = "EDITABLE" | "PARTS" | "COMPOSED" | "ELSEWHERE" | "IN_CODE";

export const WORDING_STATUS_LABEL: Record<WordingStatus, string> = {
  EDITABLE: "Editable",
  PARTS: "Editable parts",
  COMPOSED: "Office sends",
  ELSEWHERE: "Edited elsewhere",
  IN_CODE: "In code",
};

export type WordingPartSource =
  /** Stored in the wording override store (AppSetting per type). */
  | { kind: "STORE" }
  /**
   * The existing shared email template (`settings.emailTemplates[key]`, also
   * shown in Forms). Saves write there; this layer keeps its version history.
   */
  | { kind: "EMAIL_TEMPLATE"; key: AppEmailTemplateKey }
  /**
   * The existing shared in-app / SMS template (`settings.notificationTemplates[key]`:
   * web subject and body for the INBOX part, SMS body for the SMS part).
   */
  | { kind: "NOTIFICATION_TEMPLATE"; key: AppNotificationTemplateKey };

export type WordingPartDefinition = {
  /** Stable id within the type; with the transport it keys the store. Never rename. */
  id: string;
  /** Audience or part name shown on the chip ("Cleaner", "Note line"). */
  label: string;
  transport: WordingTransport;
  /** Default wording with {{variable}} placeholders (byte-identical to the code it replaced). */
  defaults: WordingFields;
  /** Variable names this part may use (looked up in the variable dictionary). */
  variables: readonly string[];
  /** Variables that must stay in the wording; a save without one is refused. */
  required: readonly string[];
  source: WordingPartSource;
  /**
   * Fields this part has, when not the transport's full set. A "line" part (a
   * fixed sentence added only when its condition holds, e.g. the admin's
   * note) has just a body.
   */
  fields?: readonly WordingField[];
  /** INBOX parts whose text is also the push title and body. */
  push?: "SHARED";
  /** Plain explanation shown under the editor (e.g. when this part is used). */
  note?: string;
};

export type TypeWordingDefinition = {
  typeKey: string;
  status: WordingStatus;
  /** Why it is not fully editable (PARTS, COMPOSED, ELSEWHERE, IN_CODE). */
  reason?: string;
  /** Existing editor for ELSEWHERE / COMPOSED types. */
  href?: string;
  parts: readonly WordingPartDefinition[];
};

/** Store key of one part on one transport. */
export function entryKey(partId: string, transport: WordingTransport): string {
  return `${partId}:${transport}`;
}

export function partFields(part: Pick<WordingPartDefinition, "transport" | "fields">): readonly WordingField[] {
  return part.fields ?? TRANSPORT_FIELDS[part.transport];
}
