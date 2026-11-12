import "server-only";
/**
 * Command "Send reminder" for an expiring document: the workforce route's
 * REQUEST_DOCUMENT action with a `documentId`. It creates a request for the
 * renewed document (same category, due on the expiry date) through the
 * existing createStaffDocumentRequest, delivered by the transports the office
 * chose, with truthful states.
 *
 * Idempotent per document per organisation day: the first reminder of the day
 * claims a unique receipt; a retry with the same key answers with the recorded
 * result, and any other reminder that day is refused with the time of the
 * first. Audited as STAFF_DOCUMENT_REMINDER_SENT.
 */
import { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { STAFF_MESSAGE_ROLES } from "@/lib/notifications/staff-roles";
import { createStaffDocumentRequest } from "./service";
import { DOCUMENT_REQUEST_TRANSPORTS, documentRequestBody, type DocumentRequestDelivery } from "./document-request-send";

export const DOCUMENT_REMINDER_RECEIPT_PREFIX = "documentReminder:";

export const documentReminderSchema = z.object({
  documentId: z.string().trim().min(1).max(200),
  transports: z.array(z.enum(DOCUMENT_REQUEST_TRANSPORTS)).min(1).max(3),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
}).strict();

export type DocumentReminderPreview = {
  documentId: string;
  title: string;
  category: string;
  expiresAt: string | null;
  person: { id: string; name: string; hasEmail: boolean; hasPhone: boolean; active: boolean };
  requestTitle: string;
  wording: string;
  sentToday: { at: string; state: string } | null;
};

export type DocumentReminderResult = {
  requestId: string;
  dayKey: string;
  delivery: DocumentRequestDelivery;
  /** True when this answer is the recorded result of an earlier, identical request. */
  replayed: boolean;
};

type ReceiptValue = { documentId: string; dayKey: string; idempotencyKey: string; actorId: string; at: string; status: "PROCESSING" | "DONE"; result?: DocumentReminderResult };

async function timeZone(): Promise<string> {
  return (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
}

async function loadDocument(documentId: string) {
  return db.staffDocument.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, category: true, expiresAt: true, user: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } } },
  });
}

function receiptKey(documentId: string, dayKey: string): string {
  return `${DOCUMENT_REMINDER_RECEIPT_PREFIX}${documentId}:${dayKey}`;
}

export function renewalTitle(title: string): string {
  return `Renewed ${title}`.slice(0, 180);
}

export async function previewDocumentReminder(documentId: string, now = new Date()): Promise<DocumentReminderPreview | null> {
  const document = await loadDocument(documentId);
  if (!document) return null;
  const zone = await timeZone();
  const dayKey = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const receipt = await db.appSetting.findUnique({ where: { key: receiptKey(document.id, dayKey) } });
  const value = receipt?.value as ReceiptValue | undefined;
  const requestTitle = renewalTitle(document.title);
  return {
    documentId: document.id,
    title: document.title,
    category: document.category,
    expiresAt: document.expiresAt?.toISOString() ?? null,
    person: { id: document.user.id, name: document.user.name ?? document.user.email ?? "This person", hasEmail: Boolean(document.user.email), hasPhone: Boolean(document.user.phone), active: document.user.isActive },
    requestTitle,
    wording: documentRequestBody({ title: requestTitle, requestedByName: null }),
    sentToday: value ? { at: value.at, state: value.status === "DONE" ? "requested" : "in progress" } : null,
  };
}

async function claimReceipt(key: string, value: ReceiptValue): Promise<ReceiptValue | null> {
  try {
    await db.appSetting.create({ data: { key, value: value as unknown as Prisma.InputJsonValue } });
    return null;
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const existing = await db.appSetting.findUnique({ where: { key } });
    return (existing?.value as ReceiptValue | undefined) ?? null;
  }
}

export async function sendDocumentReminder(actor: { id: string; name?: string | null }, input: unknown, now = new Date()): Promise<DocumentReminderResult> {
  const request = documentReminderSchema.parse(input);
  const document = await loadDocument(request.documentId);
  if (!document) throw new OfficeActionError(404, "Document not found.");
  if (!document.user.isActive) throw new OfficeActionError(409, "This account is not active, so no reminder is sent.");
  if (!STAFF_MESSAGE_ROLES.includes(document.user.role)) throw new OfficeActionError(409, "Reminders go to staff accounts only.");
  if (!document.expiresAt) throw new OfficeActionError(409, "This document has no expiry date.");

  const zone = await timeZone();
  const dayKey = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const key = receiptKey(document.id, dayKey);
  const claimed: ReceiptValue = { documentId: document.id, dayKey, idempotencyKey: request.idempotencyKey, actorId: actor.id, at: now.toISOString(), status: "PROCESSING" };
  const existing = await claimReceipt(key, claimed);
  if (existing) {
    if (existing.idempotencyKey === request.idempotencyKey && existing.result) return { ...existing.result, replayed: true };
    const at = formatInTimeZone(new Date(existing.at), zone, "HH:mm");
    throw new OfficeActionError(409, existing.idempotencyKey === request.idempotencyKey
      ? "This reminder is still being sent. Check the account before trying again."
      : `A reminder for this document was already sent today at ${at}. One reminder per document per day.`);
  }

  const created = await createStaffDocumentRequest({
    userId: document.user.id,
    requestedById: actor.id,
    category: document.category,
    title: renewalTitle(document.title),
    notes: `${document.title} expires ${formatInTimeZone(document.expiresAt, zone, "d MMM yyyy")}. Please upload the renewed document.`,
    dueAt: document.expiresAt.toISOString(),
    transports: request.transports,
  });
  const result: DocumentReminderResult = { requestId: created.id, dayKey, delivery: created.delivery, replayed: false };
  await db.appSetting.update({ where: { key }, data: { value: { ...claimed, status: "DONE", result } as unknown as Prisma.InputJsonValue } });
  await db.auditLog.create({ data: {
    userId: actor.id, action: "STAFF_DOCUMENT_REMINDER_SENT", entity: "StaffDocument", entityId: document.id,
    after: {
      requestId: created.id, dayKey, transports: request.transports, idempotencyKey: request.idempotencyKey,
      outcomes: created.delivery.outcomes.map((outcome) => ({ transport: outcome.transport, path: outcome.path, state: outcome.state, errorCode: outcome.errorCode ?? null })),
      sms: created.delivery.sms, deliveryConfirmed: false,
    } as Prisma.InputJsonValue,
  } });
  return result;
}
