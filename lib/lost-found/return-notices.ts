import "server-only";
/**
 * Messages around lost and found return requests (2026-11-20).
 *
 * - Office (`lostfound.return_request`): one inbox row per person, scope
 *   LOST_ITEM_OFFICE, when a guest asks, changes or withdraws, a client
 *   reviews, a handover needs a new arrangement, or a cleaner hands it over.
 *   Never an email, SMS or push. Best-effort: a lost notice never undoes the
 *   recorded request (the list and the nav badge show it either way).
 * - Client (`lostfound.client_return_request`): the property client's portal
 *   inbox, scope LOST_ITEM_PROPERTY_CLIENT, respecting their preferences.
 * - Cleaner (`lostfound.return_task`): the job's assigned cleaners, scope
 *   JOB_ASSIGNED_CLEANER, with the transports the office ticked.
 * - Guest acknowledgement (`lostfound.return_ack`): the office's template from
 *   Settings, sent through the external-recipient path; every attempt is on
 *   the item's timeline with the exact text and the provider's answer.
 */
import { Role, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendOfficeNotification, type OfficeSendTransport, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { ExternalMessageError, isValidExternalAddress, sendExternalRecipientMessage } from "@/lib/notifications/external-recipient";
import { getJobReference } from "@/lib/jobs/job-number";
import { resolveClientNoticeTarget } from "./client-notice";
import { buildGuestItemEmail } from "./guest-email";
import { GUEST_SMS_MAX_CHARS } from "./message";
import { describeRequestChoice, fillAcknowledgementBody, fillTemplate, guestFirstName, type ReturnMethod } from "./return-rules";
import { loadStayDetailsForItem } from "./stay-details-server";
import type { LostFoundSettings } from "./settings";

export const OFFICE_RETURN_TYPE = "lostfound.return_request";
export const CLEANER_TASK_TYPE = "lostfound.return_task";
export const CLIENT_RETURN_TYPE = "lostfound.client_return_request";

export type OfficeReturnPart = "new" | "changed" | "withdrawn" | "client-reviewed" | "needs-rearranging" | "returned";

async function itemLabels(itemId: string) {
  const item = await db.lostFoundItem.findUnique({ where: { id: itemId }, select: { itemName: true, propertyId: true } });
  if (!item) return null;
  const property = item.propertyId ? await db.property.findUnique({ where: { id: item.propertyId }, select: { name: true } }) : null;
  return { itemName: item.itemName, propertyName: property?.name ?? "no property" };
}

export async function notifyOfficeOfReturn(input: {
  itemId: string;
  requestId: string;
  /** Distinguishes one change from the next (request version, or a reason key). */
  eventSuffix: string;
  part: OfficeReturnPart;
  actorId: string | null;
  actorName: string;
  returnChoice?: string;
  reason?: string;
}): Promise<void> {
  try {
    const [labels, controls, staff] = await Promise.all([
      itemLabels(input.itemId),
      getNotificationTypeControls(),
      db.user.findMany({ where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } }, select: { id: true, role: true, name: true, email: true } }),
    ]);
    if (!labels || staff.length === 0) return;
    const wording = await loadNotificationWording(OFFICE_RETURN_TYPE);
    const inbox = wording.render(input.part, "INBOX", { actorName: input.actorName, itemName: labels.itemName, propertyName: labels.propertyName, returnChoice: input.returnChoice ?? "", reason: input.reason ?? "" });
    await sendOfficeNotification({
      typeKey: OFFICE_RETURN_TYPE,
      eventKey: OFFICE_RETURN_TYPE,
      eventId: `lostfound-return:${input.requestId}:${input.part}:${input.eventSuffix}`,
      entity: { type: "LostFoundItem", id: input.itemId },
      actorId: input.actorId,
      scopeType: "LOST_ITEM_OFFICE",
      scopeId: () => input.itemId,
      category: "jobs",
      severity: input.part === "needs-rearranging" || input.part === "new" || input.part === "changed" ? "ACTION" : "INFO",
      jobId: null,
      subject: inbox.title,
      body: inbox.body,
      url: `/v2/admin/lost-found?stage=all&open=${encodeURIComponent(input.itemId)}`,
      transports: ["INBOX"],
      recipients: staff,
      respectsPreferences: false,
      disabledTransports: controls.disabledTransports[OFFICE_RETURN_TYPE] ?? [],
    });
  } catch (err) {
    logger.error({ err, itemId: input.itemId, part: input.part }, "lost and found: office return notice failed; the request stands");
  }
}

export async function notifyClientOfReturn(input: { itemId: string; requestId: string; version: number; returnChoice: string }): Promise<void> {
  try {
    const target = await resolveClientNoticeTarget(input.itemId).catch(() => null);
    if (!target) return;
    const [labels, controls, wording] = await Promise.all([itemLabels(input.itemId), getNotificationTypeControls(), loadNotificationWording(CLIENT_RETURN_TYPE)]);
    if (!labels) return;
    const inbox = wording.render("client", "INBOX", { itemName: labels.itemName, propertyName: labels.propertyName, returnChoice: input.returnChoice });
    await sendOfficeNotification({
      typeKey: CLIENT_RETURN_TYPE,
      eventKey: CLIENT_RETURN_TYPE,
      eventId: `lostfound-client-return:${input.requestId}:${input.version}`,
      entity: { type: "LostFoundItem", id: input.itemId },
      actorId: null,
      scopeType: "LOST_ITEM_PROPERTY_CLIENT",
      scopeId: () => input.itemId,
      category: "jobs",
      severity: "INFO",
      jobId: target.item.jobId,
      subject: inbox.title,
      body: inbox.body,
      url: "/v2/client/lost-found",
      transports: ["INBOX"],
      recipients: target.recipients,
      respectsPreferences: true,
      disabledTransports: controls.disabledTransports[CLIENT_RETURN_TYPE] ?? [],
    });
  } catch (err) {
    logger.error({ err, itemId: input.itemId }, "lost and found: client return notice failed; the request stands");
  }
}

export type CleanerTaskTransport = Exclude<OfficeSendTransport, never>;

/** Tells the job's current cleaners about the handover task. Returns each transport's state. */
export async function notifyCleanersOfTask(input: { jobId: string; taskId: string; requestId: string; actorId: string; transports: OfficeSendTransport[]; taskText: string }): Promise<RecipientOutcome[]> {
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, jobNumber: true, property: { select: { name: true } }, assignments: { where: { removedAt: null }, select: { user: { select: { id: true, role: true, name: true, email: true, isActive: true } } } } },
  });
  if (!job) return [];
  const recipients = job.assignments.map((row) => row.user).filter((user) => user.isActive).map((user) => ({ id: user.id, role: user.role, name: user.name, email: user.email }));
  if (recipients.length === 0 || input.transports.length === 0) return [];
  const [controls, wording] = await Promise.all([getNotificationTypeControls(), loadNotificationWording(CLEANER_TASK_TYPE)]);
  const jobLabel = `${getJobReference(job)} · ${job.property.name}`;
  const inbox = wording.render("cleaner", "INBOX", { jobLabel, propertyName: job.property.name, messageText: input.taskText });
  return sendOfficeNotification({
    typeKey: CLEANER_TASK_TYPE,
    eventKey: CLEANER_TASK_TYPE,
    eventId: `lostfound-task:${input.requestId}:${input.taskId}`,
    entity: { type: "JobTask", id: input.taskId },
    actorId: input.actorId,
    scopeType: "JOB_ASSIGNED_CLEANER",
    scopeId: () => input.jobId,
    category: "jobs",
    severity: "ACTION",
    jobId: input.jobId,
    subject: inbox.title,
    body: inbox.body,
    url: `/v2/cleaner/jobs/${input.jobId}`,
    email: (recipient) => {
      const email = wording.render("cleaner", "EMAIL", { jobLabel, propertyName: job.property.name, messageText: input.taskText, recipientName: recipient.name ?? "" });
      return { subject: email.subject || inbox.title, html: email.html || email.body };
    },
    emailKind: "job_task_added",
    transports: input.transports,
    recipients,
    respectsPreferences: true,
    disabledTransports: controls.disabledTransports[CLEANER_TASK_TYPE] ?? [],
  });
}

// ── The guest's automatic acknowledgement ────────────────────────────────────

export type AckRecord = { sent: boolean; transport: "EMAIL" | "SMS" | null; subject: string; body: string; note: string };

/**
 * The exact acknowledgement text for a request (the Settings template, filled
 * in). It always names the stay: guest, stay dates, property and address. A
 * text message that would pass the SMS limit carries the one-line form.
 */
export async function acknowledgementText(settings: LostFoundSettings, input: { itemId: string; guestName: string; itemName: string; method: ReturnMethod; requestedDate: string | null; proposedTime: string | null; otherDetails: string | null; link: string; transport?: "EMAIL" | "SMS" | null }) {
  const app = await getAppSettings();
  const stay = await loadStayDetailsForItem(input.itemId, app.timezone || "Australia/Sydney");
  const values = {
    guestFirstName: guestFirstName(input.guestName),
    itemName: input.itemName,
    choice: describeRequestChoice(input),
    officeName: app.companyName || "sNeek Property Services",
    link: input.link,
  };
  const full = fillAcknowledgementBody(settings.acknowledgement.body, values, stay);
  const body = input.transport === "SMS" && full.length > GUEST_SMS_MAX_CHARS ? fillAcknowledgementBody(settings.acknowledgement.body, values, stay, "compact") : full;
  return { subject: fillTemplate(settings.acknowledgement.subject, values).slice(0, 200), body: body.slice(0, 1500) };
}

/**
 * Sends the acknowledgement (email when the guest gave one, else SMS) and puts
 * the exact text and the answer on the timeline. Switched off in Settings:
 * nothing is sent and nothing is recorded as sent.
 */
export async function sendGuestAcknowledgement(input: {
  settings: LostFoundSettings;
  item: { id: string; itemName: string; jobId: string | null; photos: Prisma.JsonValue };
  request: { id: string; version: number; contactName: string; contactEmail: string | null; contactPhone: string | null; method: ReturnMethod; requestedDate: string | null; proposedTime: string | null; otherDetails: string | null };
  link: { id: string; createdById: string; token: string; url: string };
}): Promise<AckRecord | null> {
  if (!input.settings.acknowledgement.enabled) return null;
  const transport: "EMAIL" | "SMS" | null = isValidExternalAddress("EMAIL", input.request.contactEmail) ? "EMAIL" : isValidExternalAddress("SMS", input.request.contactPhone) ? "SMS" : null;
  const { subject, body } = await acknowledgementText(input.settings, { itemId: input.item.id, guestName: input.request.contactName, itemName: input.item.itemName, method: input.request.method, requestedDate: input.request.requestedDate, proposedTime: input.request.proposedTime, otherDetails: input.request.otherDetails, link: input.link.url, transport });
  let record: AckRecord;
  if (!transport) {
    record = { sent: false, transport: null, subject, body, note: "Acknowledgement not sent: the guest gave no usable email or phone." };
  } else {
    try {
      const hasPhoto = Array.isArray(input.item.photos) && input.item.photos.length > 0;
      const email = transport === "EMAIL" ? await buildGuestItemEmail({ subject, body, token: input.link.token, linkUrl: input.link.url, hasPhoto }) : undefined;
      const sent = await sendExternalRecipientMessage({
        kind: "lostfound.return_ack",
        actorId: input.link.createdById,
        entityId: input.item.id,
        jobId: input.item.jobId,
        transport,
        to: transport === "EMAIL" ? input.request.contactEmail! : input.request.contactPhone!,
        subject,
        body,
        email,
        idempotencyKey: `lfr-ack:${input.request.id}`,
        audit: { requestId: input.request.id, automatic: true, linkId: input.link.id },
      });
      const how = transport === "EMAIL" ? "email" : "text message";
      record = sent.state === "provider_accepted"
        ? { sent: true, transport, subject, body, note: `Acknowledgement sent by ${how}. The provider accepted it; delivery is not confirmed.` }
        : sent.state === "already_requested"
          ? { sent: false, transport, subject, body, note: `Acknowledgement was already requested for this request; not sent again.` }
          : sent.state === "skipped"
            ? { sent: false, transport, subject, body, note: `Acknowledgement not sent: ${transport === "EMAIL" ? "email to guests is switched off or the address is suppressed" : "text messages are switched off"}.` }
            : { sent: false, transport, subject, body, note: `Acknowledgement not sent (${sent.errorCode ?? "provider error"}).` };
    } catch (err) {
      const reason = err instanceof ExternalMessageError ? err.message : "the message could not be sent";
      if (!(err instanceof ExternalMessageError)) logger.error({ err, itemId: input.item.id }, "lost and found: acknowledgement failed");
      record = { sent: false, transport, subject, body, note: `Acknowledgement not sent: ${reason}` };
    }
  }
  await db.lostFoundEvent.create({
    data: {
      itemId: input.item.id,
      userId: null,
      action: record.sent ? "RETURN_ACK_SENT" : "MESSAGE_NOT_SENT",
      note: `${record.note}\n\nSubject: ${record.subject}\n\n${record.body}`.slice(0, 4000),
      meta: { requestId: input.request.id, automatic: true, transport: record.transport, sentByApp: record.sent, deliveryConfirmed: false },
    },
  });
  return record;
}
