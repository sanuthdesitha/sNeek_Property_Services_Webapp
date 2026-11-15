import "server-only";
/**
 * "The client finished their part" (catalog `onboarding.client_finished`,
 * 2026-11-16): an INBOX-only notice through the notification intent pipeline
 * to active administrators and operations managers (both work onboarding).
 * Scope STAFF_MEMBER per person, so a role change before dispatch skips the
 * delivery. Never an email, SMS or device push (owner default: the office is
 * told by inbox only). The event id names the link, so it is sent once.
 * Queued is not delivered.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

export const ONBOARDING_CLIENT_FINISHED_TYPE = "onboarding.client_finished";

async function onboardingOffice(): Promise<OfficeRecipient[]> {
  return db.user.findMany({
    where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
    select: { id: true, role: true, name: true, email: true },
  });
}

export async function sendOnboardingClientFinishedNotice(input: {
  surveyId: string;
  surveyNumber: string;
  linkId: string;
  propertyName: string;
  sections: string[];
}): Promise<RecipientOutcome[]> {
  const recipients = await onboardingOffice();
  if (recipients.length === 0) return [];
  const typeKey = ONBOARDING_CLIENT_FINISHED_TYPE;
  const wording = await loadNotificationWording(typeKey);
  const inbox = wording.render("finished", "INBOX", { propertyName: input.propertyName, surveyNumber: input.surveyNumber, sections: input.sections.join(", ").toLowerCase() });
  const controls = await getNotificationTypeControls();
  return sendOfficeNotification({
    typeKey,
    eventKey: typeKey,
    eventId: `onboarding-client-finished:${input.linkId}`,
    entity: { type: "PropertyOnboardingSurvey", id: input.surveyId },
    actorId: null,
    scopeType: "STAFF_MEMBER",
    scopeId: (recipient) => recipient.id,
    category: "approvals",
    severity: "ACTION",
    jobId: null,
    subject: inbox.title,
    body: inbox.body,
    url: `/v2/admin/onboarding/${encodeURIComponent(input.surveyNumber)}`,
    transports: ["INBOX"],
    recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
}
