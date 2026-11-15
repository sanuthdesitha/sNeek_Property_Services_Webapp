import "server-only";
/**
 * Amenities survey links (moved out of the property route unchanged so the
 * coverage page can make several in one request): a random token kept in
 * AppSetting `amenitiesSurvey:<token>` for 14 days, audited per property.
 * Making a new link never cancels an older one.
 */
import crypto from "crypto";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";

type RequestLike = Parameters<typeof resolveAppUrl>[1];

export const AMENITIES_TOKEN_TTL_DAYS = 14;

export type MintedAmenitiesLink = { propertyId: string; url: string; expiresAt: Date };

export async function mintAmenitiesLink(propertyId: string, actorId: string, req?: RequestLike, now: Date = new Date()): Promise<MintedAmenitiesLink> {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(now.getTime() + AMENITIES_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.appSetting.create({
    data: {
      key: `amenitiesSurvey:${token}`,
      value: { propertyId, createdById: actorId, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() } as any,
    },
  });
  await db.auditLog.create({
    data: { userId: actorId, action: "AMENITIES_LINK_CREATE", entity: "Property", entityId: propertyId, after: { expiresAt: expiresAt.toISOString() } as any },
  });
  return { propertyId, url: resolveAppUrl(`/amenities/${token}`, req), expiresAt };
}
