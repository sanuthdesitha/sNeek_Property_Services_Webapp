import "server-only";
/**
 * "Email it to the client" for a property's amenities survey link (catalog
 * `checklist.amenities_link`, owner default 2026-11-17).
 *
 * The office has just made the link (POST /api/admin/properties/:id/
 * amenities-link, a token kept in AppSetting for 14 days). This sends THAT
 * link, never one the browser makes up: the token is looked up on the server,
 * must belong to this property and must not have expired. Email only, to the
 * client's billing email on the client record. The words are the type's
 * editable wording and the email is its block design (lib/notifications/
 * wording → lib/email-design); it goes through the shared external-recipient
 * path, which applies the suppression list, rate limits, one send per
 * idempotency key, a masked audit and the delivery log. Provider accepted is
 * not delivered.
 *
 * Onboarding's "Send link to client" (lib/onboarding/workspace/client-link.ts)
 * is a different link (an onboarding survey's parts, hashed tokens, revocable),
 * so it is not reused for the link itself; the sending path is the same one.
 */
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { externalTransportAvailability, maskContact, sendExternalRecipientMessage, type ExternalMessageResult } from "@/lib/notifications/external-recipient";

export const AMENITIES_LINK_TYPE = "checklist.amenities_link";

export class AmenitiesLinkEmailError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const TOKEN_PATTERN = /^[a-f0-9]{48}$/;

type StoredLink = { propertyId?: unknown; expiresAt?: unknown };

export type AmenitiesEmailResult = ExternalMessageResult & { to: string; expiresAt: string };

export async function emailAmenitiesLink(input: { propertyId: string; token: string; actorId: string; idempotencyKey: string; now?: Date }): Promise<AmenitiesEmailResult> {
  const now = input.now ?? new Date();
  if (!TOKEN_PATTERN.test(input.token)) throw new AmenitiesLinkEmailError(400, "That survey link is not one this app made.");
  const row = await db.appSetting.findUnique({ where: { key: `amenitiesSurvey:${input.token}` } });
  const stored = (row?.value ?? null) as StoredLink | null;
  if (!stored || stored.propertyId !== input.propertyId) throw new AmenitiesLinkEmailError(404, "That survey link is not this property's. Make a new link first.");
  const expiresAt = typeof stored.expiresAt === "string" ? new Date(stored.expiresAt) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) throw new AmenitiesLinkEmailError(409, "That survey link has expired. Make a new link first.");

  const property = await db.property.findUnique({ where: { id: input.propertyId }, select: { id: true, name: true, client: { select: { email: true } } } });
  if (!property) throw new AmenitiesLinkEmailError(404, "Property not found.");
  const to = property.client?.email?.trim();
  if (!to) throw new AmenitiesLinkEmailError(409, "This client has no billing email on their record. Add one, or copy the link and send it yourself.");
  const availability = (await externalTransportAvailability()).EMAIL;
  if (!availability.available) throw new AmenitiesLinkEmailError(409, availability.reason ?? "Email is not available on this server.");

  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const url = resolveAppUrl(`/amenities/${input.token}`);
  const wording = await loadNotificationWording(AMENITIES_LINK_TYPE);
  const email = wording.render("email", "EMAIL", {
    companyName: settings.companyName || "sNeek",
    propertyName: property.name,
    surveyUrl: url,
    expiresOn: formatInTimeZone(expiresAt, timezone, "EEE d MMM yyyy"),
  });
  const sent = await sendExternalRecipientMessage({
    kind: AMENITIES_LINK_TYPE,
    actorId: input.actorId,
    entityId: property.id,
    jobId: null,
    transport: "EMAIL",
    to,
    subject: email.subject,
    body: `Amenities survey link for ${property.name}`,
    email: { subject: email.subject, html: email.html },
    idempotencyKey: `amenities-email:${input.idempotencyKey}`,
    audit: { expiresAt: expiresAt.toISOString() },
    now,
  });
  return { state: sent.state, errorCode: sent.errorCode, to: maskContact(to), expiresAt: expiresAt.toISOString() };
}
