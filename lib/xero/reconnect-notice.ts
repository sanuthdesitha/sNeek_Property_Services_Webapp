import "server-only";
/**
 * "Xero needs reconnecting" (2026-11-15; catalog `xero.reconnect_needed`): an
 * INBOX-only notice, through the notification intent pipeline, to active
 * administrators (Xero is managed in an admin-only settings page). Scope
 * STAFF_MEMBER per administrator, so a role change before dispatch skips the
 * delivery. Never an email, SMS or device push. Sent once per outage: the
 * token service claims `XeroConnection.reconnectNoticeAt` before calling
 * this, and the event id names the outage. Queued is not delivered.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import type { XeroReconnectNoticeInput } from "./token-service";

export const XERO_RECONNECT_NOTICE_TYPE = "xero.reconnect_needed";
export const XERO_SETTINGS_URL = "/v2/admin/settings?tab=xero";

async function activeAdministrators(): Promise<OfficeRecipient[]> {
  return db.user.findMany({
    where: { isActive: true, role: Role.ADMIN },
    select: { id: true, role: true, name: true, email: true },
  });
}

export async function sendXeroReconnectNotice(input: XeroReconnectNoticeInput): Promise<RecipientOutcome[]> {
  const recipients = await activeAdministrators();
  if (recipients.length === 0) return [];
  const typeKey = XERO_RECONNECT_NOTICE_TYPE;
  const wording = await loadNotificationWording(typeKey);
  const inbox = wording.render("needed", "INBOX", { tenantName: input.tenantName, reason: input.reason });
  const controls = await getNotificationTypeControls();
  return sendOfficeNotification({
    typeKey,
    eventKey: typeKey,
    eventId: `xero-reconnect:${input.connectionId}:${input.needsReconnectAt.toISOString()}`,
    entity: { type: "XeroConnection", id: input.connectionId },
    actorId: null,
    scopeType: "STAFF_MEMBER",
    scopeId: (recipient) => recipient.id,
    category: "billing",
    severity: "ACTION",
    jobId: null,
    subject: inbox.title,
    body: inbox.body,
    url: XERO_SETTINGS_URL,
    transports: ["INBOX"],
    recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
}
