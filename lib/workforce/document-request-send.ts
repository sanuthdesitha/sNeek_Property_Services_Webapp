import "server-only";
/**
 * Delivery of a staff document request (catalog `workforce.document_request`),
 * used by the workforce route's REQUEST_DOCUMENT action and by Command's
 * "Send reminder" for an expiring document.
 *
 * Before this module, the request wrote its inbox row as "SENT" and fired email
 * and SMS without recording what the providers answered. Now:
 * - "PUSH" (the inbox row with its phone-app push, and browser push) and
 *   "EMAIL" go through the office pipeline with the STAFF_MEMBER scope
 *   (re-checked at dispatch), each with its truthful state;
 * - "SMS" goes through the SMS chokepoint and is recorded with what the
 *   provider answered (accepted, switched off, not configured, failed);
 * - transports are explicit; the caller chooses them.
 */
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { defaultNotificationWording, loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";

export const DOCUMENT_REQUEST_TYPE = "workforce.document_request";
export const DOCUMENT_REQUEST_TRANSPORTS = ["PUSH", "EMAIL", "SMS"] as const;
export type DocumentRequestTransport = (typeof DOCUMENT_REQUEST_TRANSPORTS)[number];

export type SmsOutcome = { transport: "SMS"; state: "provider_accepted" | "already_requested" | "skipped" | "failed"; errorCode: string | null };

export type DocumentRequestDelivery = { outcomes: RecipientOutcome[]; sms: SmsOutcome | null };

export type DocumentRequestRecipient = { id: string; role: Role; name: string | null; email: string | null; phone: string | null };

export type DocumentRequestMessage = {
  requestId: string;
  title: string;
  notes: string | null;
  requestedByName: string | null;
  /** Stable per request so a retry is the same send. */
  eventId: string;
  actorId: string;
};

export const DOCUMENT_REQUEST_SMS_TYPE = "workforce.document_request_sms";

function documentRequestInbox(message: Pick<DocumentRequestMessage, "title" | "requestedByName">, wording: WordingRenderer) {
  return wording.render("staff", "INBOX", { requestedByName: message.requestedByName ?? "The office", documentTitle: message.title });
}

/** The request's inbox wording (pass the loaded wording; the default is used otherwise). */
export function documentRequestBody(message: Pick<DocumentRequestMessage, "title" | "requestedByName">, wording: WordingRenderer = defaultNotificationWording("workforce.document_request")): string {
  return documentRequestInbox(message, wording).body;
}

async function sendSms(recipient: DocumentRequestRecipient, message: DocumentRequestMessage): Promise<SmsOutcome> {
  if (!recipient.phone) return { transport: "SMS", state: "failed", errorCode: "missing_phone" };
  let outcome: SmsOutcome = { transport: "SMS", state: "already_requested", errorCode: null };
  await dispatchNotificationOnce({ event: `${message.eventId}:SMS`, day: "office", recipientId: recipient.id }, async () => {
    const smsWording = await loadNotificationWording(DOCUMENT_REQUEST_SMS_TYPE);
    const inboxWording = await loadNotificationWording("workforce.document_request");
    const sent = await sendSmsDetailed(recipient.phone!, smsWording.render("staff", "SMS", { documentTitle: message.title }).body);
    outcome = { transport: "SMS", state: sent.status === "disabled" ? "skipped" : sent.ok ? "provider_accepted" : "failed", errorCode: sent.ok ? null : `sms_${sent.status}` };
    await db.notification.create({ data: {
      userId: recipient.id, channel: "SMS", subject: "Document requested", body: documentRequestBody(message, inboxWording),
      status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "SMS delivery failed.",
    } });
  });
  return outcome;
}

export async function deliverDocumentRequest(
  recipient: DocumentRequestRecipient,
  message: DocumentRequestMessage,
  transports: readonly DocumentRequestTransport[],
): Promise<DocumentRequestDelivery> {
  const typeKey = DOCUMENT_REQUEST_TYPE;
  const office = transports.filter((transport): transport is "PUSH" | "EMAIL" => transport !== "SMS");
  const controls = office.length ? await getNotificationTypeControls() : null;
  const wording = await loadNotificationWording(typeKey);
  const inbox = documentRequestInbox(message, wording);
  const body = inbox.body;
  const outcomes = office.length && controls ? await sendOfficeNotification({
    typeKey, eventKey: "workforce.document_request", eventId: message.eventId,
    entity: { type: "StaffDocumentRequest", id: message.requestId }, actorId: message.actorId,
    scopeType: "STAFF_MEMBER", scopeId: (person) => person.id,
    category: "account", severity: "ACTION", jobId: null,
    subject: inbox.title, body,
    email: (person) => {
      const email = wording.render("staff", "EMAIL", {
        recipientName: person.name ?? "there",
        documentTitle: message.title,
        notesParagraph: wording.line("notes-paragraph", "EMAIL", { note: message.notes }, Boolean(message.notes)),
      });
      return { subject: email.subject, html: email.html };
    },
    emailKind: "workforce_update",
    transports: office,
    recipients: [{ id: recipient.id, role: recipient.role, name: recipient.name, email: recipient.email }],
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  }) : [];
  const sms = transports.includes("SMS") ? await sendSms(recipient, message).catch((): SmsOutcome => ({ transport: "SMS", state: "failed", errorCode: "provider_outcome_unknown" })) : null;
  return { outcomes, sms };
}
