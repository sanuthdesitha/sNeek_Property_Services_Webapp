import "server-only";
/**
 * Messages for client-handled maintenance (2026-11-18).
 *
 * To the client (catalog `client.maintenance_handover` and
 * `client.maintenance_reminder`): the office chooses the transports
 * explicitly on each send, portal inbox and/or email. INBOX is the inbox row
 * only, never a phone or browser push. Both go through the office pipeline
 * (`sendOfficeNotification`): queued intents with the recipient scope
 * MAINTENANCE_ITEM_CLIENT re-checked at dispatch, or the direct email send
 * while the email outbox transport is off, recorded as such. Every send is
 * behind the sending safeguards gate (lib/notifications/safeguards), and the
 * client's notification preferences are respected.
 *
 * To the office (catalog `maintenance.client_progress`): one inbox row per
 * person when the client answers, sets a date or finishes. Never an email,
 * SMS or push.
 *
 * Every outcome is the transport's own state; none means "read". The client's
 * tradesperson is never messaged.
 */
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { defaultNotificationWording, loadNotificationWording } from "@/lib/notifications/wording/render";
import { describeDeliveryOutcome } from "@/lib/maintenance/client-handling-rules";
import type { ClientMessageOutcome, ClientMessageRecord, ClientMessageTransport } from "@/lib/maintenance/client-handling-types";

export const CLIENT_HANDOVER_TYPE_KEY = "client.maintenance_handover";
export const CLIENT_REMINDER_TYPE_KEY = "client.maintenance_reminder";
export const OFFICE_PROGRESS_TYPE_KEY = "maintenance.client_progress";

const CLIENT_URL = "/v2/client/maintenance";

export type ClientMessageKind = "handover" | "reminder";

/** Who a client message would go to, and why it cannot go at all. */
export type ClientMessageTarget = {
  itemTitle: string;
  propertyName: string;
  clientName: string | null;
  notificationsOff: boolean;
  recipients: OfficeRecipient[];
  /** Why nothing can be sent (no client, notifications off, no login), or null. */
  refusal: string | null;
};

export async function resolveClientMessageTarget(itemId: string): Promise<ClientMessageTarget | null> {
  const item = await db.propertyMaintenanceItem.findUnique({
    where: { id: itemId },
    select: {
      title: true,
      property: {
        select: {
          name: true,
          client: {
            select: {
              name: true,
              notificationPref: { select: { notificationsEnabled: true } },
              users: { where: { role: Role.CLIENT, isActive: true }, select: { id: true, role: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!item) return null;
  const client = item.property.client;
  const notificationsOff = Boolean(client?.notificationPref && !client.notificationPref.notificationsEnabled);
  const recipients: OfficeRecipient[] = (client?.users ?? []).map((user) => ({ id: user.id, role: user.role, name: user.name, email: user.email }));
  const refusal = !client
    ? "This property has no client to tell."
    : notificationsOff
      ? "This client has switched off notifications."
      : recipients.length === 0
        ? "This client has no active portal login to tell."
        : null;
  return { itemTitle: item.title, propertyName: item.property.name, clientName: client?.name ?? null, notificationsOff, recipients, refusal };
}

function toOutcome(outcome: RecipientOutcome): ClientMessageOutcome {
  const described = describeDeliveryOutcome(outcome.state, outcome.errorCode ?? null);
  return { name: outcome.name, transport: outcome.transport, state: outcome.state, errorCode: outcome.errorCode ?? null, tone: described.tone, label: described.label };
}

/** The exact inbox wording the client would get (shown on the item page before sending). */
export async function previewClientMessage(kind: ClientMessageKind, itemId: string, note: string | null): Promise<{ title: string; body: string } | null> {
  const target = await resolveClientMessageTarget(itemId);
  if (!target) return null;
  const typeKey = kind === "handover" ? CLIENT_HANDOVER_TYPE_KEY : CLIENT_REMINDER_TYPE_KEY;
  const wording = await loadNotificationWording(typeKey).catch(() => defaultNotificationWording(typeKey));
  const officeNote = kind === "handover" && note ? wording.line("note-line", "INBOX", { note }, true) : "";
  const inbox = wording.render("client", "INBOX", { itemTitle: target.itemTitle, propertyName: target.propertyName, officeNote });
  return { title: inbox.title, body: inbox.body };
}

/**
 * Send the hand-over message or a reminder with the chosen transports. Call
 * only after the hand-over or the reminder claim has committed. The request
 * key makes a repeat answer from the pipeline's own records (nothing twice).
 */
export async function sendClientMaintenanceMessage(input: {
  kind: ClientMessageKind;
  itemId: string;
  actorId: string;
  transports: readonly ClientMessageTransport[];
  requestKey: string;
  note: string | null;
}): Promise<ClientMessageRecord> {
  const at = new Date().toISOString();
  const transports = Array.from(new Set(input.transports));
  if (transports.length === 0) return { at, transports, refusal: "No message was chosen.", outcomes: [], taken: false };
  const target = await resolveClientMessageTarget(input.itemId);
  if (!target) return { at, transports, refusal: "The item no longer exists.", outcomes: [], taken: false };
  if (target.refusal) return { at, transports, refusal: target.refusal, outcomes: [], taken: false };

  const typeKey = input.kind === "handover" ? CLIENT_HANDOVER_TYPE_KEY : CLIENT_REMINDER_TYPE_KEY;
  const [controls, wording] = await Promise.all([getNotificationTypeControls(), loadNotificationWording(typeKey)]);
  const officeNote = input.kind === "handover" && input.note ? wording.line("note-line", "INBOX", { note: input.note }, true) : "";
  const inbox = wording.render("client", "INBOX", { itemTitle: target.itemTitle, propertyName: target.propertyName, officeNote });
  const subject = inbox.title || `A repair at ${target.propertyName} is waiting for you`;
  try {
    const outcomes = await sendOfficeNotification({
      typeKey,
      eventKey: typeKey,
      eventId: `maintenance-client-${input.kind}:${input.itemId}:${input.requestKey}`,
      entity: { type: "PropertyMaintenanceItem", id: input.itemId },
      actorId: input.actorId,
      scopeType: "MAINTENANCE_ITEM_CLIENT",
      scopeId: () => input.itemId,
      category: "jobs",
      severity: "ACTION",
      jobId: null,
      subject,
      body: inbox.body,
      url: CLIENT_URL,
      email: (recipient) => {
        const email = wording.render("client", "EMAIL", { recipientName: recipient.name ?? "there", propertyName: target.propertyName, messageText: inbox.body });
        return { subject: email.subject || subject, html: email.html || email.body };
      },
      emailKind: "client_job_update",
      transports: [...transports],
      recipients: target.recipients,
      // The client's own notification preferences decide, always.
      respectsPreferences: true,
      disabledTransports: controls.disabledTransports[typeKey] ?? [],
    });
    const mapped = outcomes.map(toOutcome);
    return { at, transports, refusal: null, outcomes: mapped, taken: mapped.some((outcome) => outcome.tone === "sent") };
  } catch (err) {
    logger.error({ err, itemId: input.itemId, kind: input.kind }, "client-handled maintenance: message could not be queued");
    return {
      at,
      transports,
      refusal: null,
      outcomes: transports.map((transport) => ({ name: target.clientName ?? "Client", transport, state: "failed", errorCode: "not_queued", tone: "failed" as const, label: "Failed: the message could not be queued" })),
      taken: false,
    };
  }
}

export type OfficeProgressPart = "accepted" | "declined" | "date" | "done" | "not-done";

/**
 * Tell the office the client moved the item. Inbox only, one row per person
 * per action (the event id carries the item version). Best-effort: a lost
 * notice must never undo the client's answer, which is already recorded.
 */
export async function notifyOfficeOfClientProgress(input: {
  itemId: string;
  version: number;
  part: OfficeProgressPart;
  actorId: string;
  actorName: string;
  reason?: string | null;
  plannedStart?: string | null;
}): Promise<void> {
  try {
    const [item, settings, controls, staff] = await Promise.all([
      db.propertyMaintenanceItem.findUnique({ where: { id: input.itemId }, select: { title: true, property: { select: { name: true } } } }),
      getAppSettings(),
      getNotificationTypeControls(),
      db.user.findMany({ where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } }, select: { id: true, role: true, name: true, email: true } }),
    ]);
    if (!item || staff.length === 0) return;
    const wording = await loadNotificationWording(OFFICE_PROGRESS_TYPE_KEY);
    const timeZone = settings.timezone || "Australia/Sydney";
    const when = input.plannedStart ? formatInTimeZone(new Date(input.plannedStart), timeZone, "EEE d MMM HH:mm") : "no date (cleared)";
    const inbox = wording.render(input.part, "INBOX", {
      actorName: input.actorName,
      itemTitle: item.title,
      propertyName: item.property.name,
      reason: input.reason ?? "",
      when,
    });
    await sendOfficeNotification({
      typeKey: OFFICE_PROGRESS_TYPE_KEY,
      eventKey: OFFICE_PROGRESS_TYPE_KEY,
      eventId: `maintenance-client-progress:${input.itemId}:${input.version}:${input.part}`,
      entity: { type: "PropertyMaintenanceItem", id: input.itemId },
      actorId: input.actorId,
      scopeType: "MAINTENANCE_OFFICE",
      scopeId: () => input.itemId,
      category: "jobs",
      severity: input.part === "declined" || input.part === "not-done" ? "ACTION" : "INFO",
      jobId: null,
      subject: inbox.title,
      body: inbox.body,
      url: `/v2/admin/maintenance/${input.itemId}`,
      transports: ["INBOX"],
      recipients: staff,
      respectsPreferences: false,
      disabledTransports: controls.disabledTransports[OFFICE_PROGRESS_TYPE_KEY] ?? [],
    });
  } catch (err) {
    logger.error({ err, itemId: input.itemId, part: input.part }, "client-handled maintenance: office notice failed; the client's answer stands");
  }
}
