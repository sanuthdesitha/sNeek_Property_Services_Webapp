import "server-only";
/**
 * "Email design published" (catalog `email.design_published`): an inbox
 * notice, through the notification intent pipeline, to the OTHER active
 * administrators when someone publishes an email design. Transports are
 * explicit (INBOX only: never email, SMS or device push). One event per
 * published version. A failure is logged and never undoes the publish.
 * Queued is not delivered.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendOfficeNotification } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

export const EMAIL_DESIGN_PUBLISHED_TYPE = "email.design_published";

export async function notifyEmailDesignPublished(input: { key: string; label: string; typeKey: string; version: number; change: string; actor: { id: string; name: string | null } }): Promise<void> {
  try {
    const recipients = await db.user.findMany({ where: { isActive: true, role: Role.ADMIN, id: { not: input.actor.id } }, select: { id: true, role: true, name: true, email: true } });
    if (recipients.length === 0) return;
    const wording = await loadNotificationWording(EMAIL_DESIGN_PUBLISHED_TYPE);
    const inbox = wording.render("published", "INBOX", { emailName: input.label, actorName: input.actor.name ?? "An administrator", version: input.version, changeSummary: input.change ? `${input.change.replace(/[.;]\s*$/, "")}.` : "" });
    const controls = await getNotificationTypeControls();
    await sendOfficeNotification({
      typeKey: EMAIL_DESIGN_PUBLISHED_TYPE,
      eventKey: EMAIL_DESIGN_PUBLISHED_TYPE,
      eventId: `email-design-published:${input.key}:v${input.version}`,
      entity: { type: "EmailDesign", id: input.key },
      actorId: input.actor.id,
      scopeType: "STAFF_MEMBER",
      scopeId: (recipient) => recipient.id,
      category: "account",
      severity: "INFO",
      jobId: null,
      subject: inbox.title,
      body: inbox.body,
      url: `/v2/admin/notifications?type=${encodeURIComponent(input.typeKey)}&email=${encodeURIComponent(input.key)}`,
      transports: ["INBOX"],
      recipients,
      respectsPreferences: typeRespectsPreferences(controls, EMAIL_DESIGN_PUBLISHED_TYPE),
      disabledTransports: controls.disabledTransports[EMAIL_DESIGN_PUBLISHED_TYPE] ?? [],
    });
  } catch (error) {
    logger.warn({ key: input.key, error: error instanceof Error ? error.message : String(error) }, "Email design published; the notice to other administrators was not queued");
  }
}
