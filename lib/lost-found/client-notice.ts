import "server-only";
/**
 * "Tell client" about a lost and found item, sent from the app (catalog
 * `lostfound.client_notice`).
 *
 * The recipients are the active CLIENT logins of the client that owns the
 * property the item was found at, addressed through the pipeline's
 * LOST_ITEM_PROPERTY_CLIENT scope (re-checked when queued and when
 * dispatched). The client's own "no notifications" choice is honoured, as for
 * the client delay notice. Transports are chosen per send. The route allows
 * ADMIN, or OPS_MANAGER with the Lost & found pack at manage
 * (`office-send-rules.ts`), and refuses impersonation.
 *
 * Every send leaves a timeline entry with the real states: "Client told (sent
 * from the app)" when at least one transport took it (queued, in the inbox,
 * accepted by the provider), otherwise "Message not sent" with the reasons.
 * The item's status never changes (telling the client is not a stage).
 */
import { plainMessageEmail } from "@/lib/email-design/build-email";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { OfficeActionError, type OfficeActionResult } from "@/lib/notifications/office-actions";
import { outcomeTaken, sendOfficeNotification, type OfficeRecipient } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import type { OfficeActorRole } from "@/lib/notifications/office-send-rules";

export const LOST_FOUND_CLIENT_NOTICE_TYPE = "lostfound.client_notice";

export const clientNoticeSchema = z.object({
  lostFoundItemId: z.string().trim().min(1).max(200),
  transports: z.array(z.enum(["PUSH", "EMAIL"])).min(1).max(2),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
}).strict();

export type ClientNoticeTarget = {
  item: { id: string; itemName: string; jobId: string | null };
  client: { id: string; name: string };
  recipients: OfficeRecipient[];
};

const userSelect = { id: true, role: true, name: true, email: true } satisfies Prisma.UserSelect;

/**
 * The item, its property's client and the client's active logins, with the
 * refusals the send applies: no item, no property, no client, the client
 * switched notifications off, no active login. Shared by the send and the
 * dialog's preview, so the dialog says exactly why it cannot send.
 */
export async function resolveClientNoticeTarget(itemId: string): Promise<ClientNoticeTarget> {
  const item = await db.lostFoundItem.findUnique({ where: { id: itemId }, select: { id: true, itemName: true, jobId: true, propertyId: true } });
  if (!item) throw new OfficeActionError(404, "Lost and found item not found.");
  if (!item.propertyId) throw new OfficeActionError(400, "This item has no property, so there is no client to tell.");
  const property = await db.property.findUnique({
    where: { id: item.propertyId },
    select: { client: { select: { id: true, name: true, notificationPref: { select: { notificationsEnabled: true } }, users: { where: { role: "CLIENT", isActive: true }, select: userSelect } } } },
  });
  const client = property?.client;
  if (!client) throw new OfficeActionError(400, "The item's property has no client to tell.");
  if (client.notificationPref && !client.notificationPref.notificationsEnabled) throw new OfficeActionError(409, "This client has switched off notifications.");
  const recipients: OfficeRecipient[] = client.users.map((user) => ({ id: user.id, role: user.role, name: user.name, email: user.email }));
  if (!recipients.length) throw new OfficeActionError(400, "This client has no active login to notify.");
  return { item: { id: item.id, itemName: item.itemName, jobId: item.jobId }, client: { id: client.id, name: client.name }, recipients };
}

export type ClientNoticeResult = OfficeActionResult & { taken: boolean };

function timelineNote(result: OfficeActionResult, taken: boolean, body: string): string {
  const lines = result.outcomes.map((outcome) => `${outcome.name}: ${outcome.transport} ${outcome.state.replace(/_/g, " ")}${outcome.errorCode ? ` (${outcome.errorCode.replace(/_/g, " ")})` : ""}`);
  const head = taken
    ? "Client told (sent from the app). Each line is what the transport reported; none confirms the client has read it."
    : "Message to the client not sent.";
  return `${head}\n${lines.join("\n")}\n\nMessage:\n${body}`.slice(0, 4000);
}

/** `actorRole`: the role that allowed the send (ADMIN, or OPS_MANAGER with the Lost & found pack), kept on the audit row. */
export async function sendLostItemClientNotice(actorId: string, input: unknown, actorRole: OfficeActorRole | null = null): Promise<ClientNoticeResult> {
  const request = clientNoticeSchema.parse(input);
  const { item, client, recipients } = await resolveClientNoticeTarget(request.lostFoundItemId);
  const controls = await getNotificationTypeControls();
  const typeKey = LOST_FOUND_CLIENT_NOTICE_TYPE;
  const outcomes = await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `lostfound-client:${item.id}:${request.idempotencyKey}`,
    entity: { type: "LostFoundItem", id: item.id }, actorId,
    scopeType: "LOST_ITEM_PROPERTY_CLIENT", scopeId: () => item.id,
    category: "jobs", severity: "INFO", jobId: item.jobId,
    subject: request.subject, body: request.body, url: "/client",
    email: (recipient) => plainMessageEmail({ subject: request.subject, text: request.body, greetingName: recipient.name ?? null }),
    emailKind: "client_job_update",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
  const result: OfficeActionResult = { outcomes, refused: [] };
  const taken = outcomes.some(outcomeTaken);
  // A retry of the same request (same key) is answered by the pipeline with the
  // states it already has; it does not add a second timeline entry.
  const earlier = await db.auditLog.findFirst({
    where: { action: "LOST_FOUND_CLIENT_NOTICE_SENT", entity: "LostFoundItem", entityId: item.id, after: { path: ["idempotencyKey"], equals: request.idempotencyKey } },
    select: { id: true },
  });
  if (earlier) return { ...result, taken };
  await db.lostFoundEvent.create({ data: {
    itemId: item.id, userId: actorId, action: taken ? "CLIENT_CONTACTED" : "MESSAGE_NOT_SENT",
    note: timelineNote(result, taken, request.body),
    meta: { sentByApp: true, recordedByOffice: false, transports: request.transports, clientId: client.id, idempotencyKey: request.idempotencyKey, outcomes: outcomes.map((o) => ({ userId: o.userId, transport: o.transport, path: o.path, state: o.state, errorCode: o.errorCode ?? null })), deliveryConfirmed: false } as Prisma.InputJsonValue,
  } });
  await db.auditLog.create({ data: {
    userId: actorId, jobId: item.jobId, action: "LOST_FOUND_CLIENT_NOTICE_SENT", entity: "LostFoundItem", entityId: item.id,
    after: { actorRole, clientId: client.id, transports: request.transports, idempotencyKey: request.idempotencyKey, outcomes: outcomes.map((o) => ({ userId: o.userId, transport: o.transport, state: o.state, errorCode: o.errorCode ?? null })), deliveryConfirmed: false } as Prisma.InputJsonValue,
  } });
  return { ...result, taken };
}
