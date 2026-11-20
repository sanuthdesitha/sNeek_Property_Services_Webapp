import "server-only";
/**
 * The guest's no-login link to one lost item (2026-11-20).
 *
 * Token: 32 bytes of HMAC-SHA256 (keyed with the server secret) over the link
 * id and a random salt, base64url (43 characters). Stored: only the HMAC of
 * the token (`tokenHash`, the same keyed-hash convention as the client
 * onboarding link), so a copy of the database alone cannot open any item. The
 * office needs to see the link in the drafts it sends, so the token is rebuilt
 * on the server from the salt and the secret instead of being shown once and
 * lost; rotating the server secret invalidates every link.
 *
 * Every public request finds the item from the token alone (never from an id
 * the browser sends), is rate limited, and refuses a revoked or expired link.
 * One open link per item: renewing revokes the previous one.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { LostFoundGuestLink, LostFoundItem } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/security/rate-limit";
import { calendarDaysBetween, zonedDayBoundary } from "./holding";
import { FALLBACK_LINK_DAYS, readLostFoundSettings, type LostFoundSettings } from "./settings";
import { isOpenStatus } from "./status";

export const GUEST_LINK_PATH = "/lost-found";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;

export class GuestLinkError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function linkSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 16) throw new GuestLinkError(503, "Guest links are not available: the server has no signing secret.");
  return secret;
}

export function guestLinkToken(link: Pick<LostFoundGuestLink, "id" | "tokenSalt">): string {
  return createHmac("sha256", linkSecret()).update(`lost-found-token:${link.id}:${link.tokenSalt}`).digest("base64url");
}

export function hashGuestLinkToken(token: string): string {
  return createHmac("sha256", linkSecret()).update(`lost-found-link:${token}`).digest("hex");
}

export function guestLinkUrl(token: string): string {
  return resolveAppUrl(`${GUEST_LINK_PATH}/${token}`);
}

/** The first (or n-th) photo of the item behind the token; never another item's. */
export function guestPhotoUrl(token: string, index = 0): string {
  return resolveAppUrl(`/api/public/lost-found/${token}/photo${index > 0 ? `?n=${index}` : ""}`);
}

/**
 * When a new link stops working: the configured number of days, or else the
 * end of the holding period's last day (organisation calendar); if that day
 * has passed or is less than a day away, FALLBACK_LINK_DAYS from now.
 */
export function guestLinkExpiry(input: { foundAt: Date; now: Date; timeZone: string; settings: Pick<LostFoundSettings, "linkDays" | "holdingDays"> }): Date {
  const { foundAt, now, timeZone, settings } = input;
  if (settings.linkDays) return new Date(now.getTime() + settings.linkDays * DAY_MS);
  const daysHeld = calendarDaysBetween(foundAt, now, timeZone);
  const daysLeft = settings.holdingDays - daysHeld;
  if (daysLeft >= 1) {
    const lastDay = new Date(now.getTime() + daysLeft * DAY_MS);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(lastDay);
    const end = zonedDayBoundary(key, timeZone, "end");
    if (end && end.getTime() > now.getTime() + DAY_MS) return end;
  }
  return new Date(now.getTime() + FALLBACK_LINK_DAYS * DAY_MS);
}

export type GuestLinkSummary = { id: string; url: string; expiresAt: string; createdAt: string; firstOpenedAt: string | null; lastOpenedAt: string | null };

function summarize(link: LostFoundGuestLink): GuestLinkSummary {
  return {
    id: link.id,
    url: guestLinkUrl(guestLinkToken(link)),
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
    firstOpenedAt: link.firstOpenedAt?.toISOString() ?? null,
    lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null,
  };
}

/** The item's open link (not revoked, not expired), or null. */
export async function activeGuestLink(itemId: string, now: Date = new Date()): Promise<GuestLinkSummary | null> {
  const link = await db.lostFoundGuestLink.findFirst({ where: { itemId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  return link ? summarize(link) : null;
}

/**
 * Returns the item's open link, creating one when none is open ("ensure"), or
 * revokes the open one and creates a fresh one ("renew"). Under the item's row
 * lock, so two clicks never leave two open links. Refused for a closed item
 * and while public return requests are switched off.
 */
export async function ensureGuestLink(itemId: string, actorId: string, mode: "ensure" | "renew", now: Date = new Date()): Promise<GuestLinkSummary> {
  const [settings, appSettings] = await Promise.all([readLostFoundSettings(), getAppSettings()]);
  if (!settings.publicReturnRequests) throw new GuestLinkError(409, "Guest return links are switched off in Settings › Lost and found.");
  linkSecret();
  const timeZone = appSettings.timezone || "Australia/Sydney";
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LostFoundItem" WHERE "id" = ${itemId} FOR UPDATE`;
    const item = await tx.lostFoundItem.findUnique({ where: { id: itemId }, select: { id: true, status: true, createdAt: true } });
    if (!item) throw new GuestLinkError(404, "Item not found.");
    if (!isOpenStatus(item.status)) throw new GuestLinkError(409, "This item is closed, so no guest link is offered. Reopen it first.");
    const open = await tx.lostFoundGuestLink.findFirst({ where: { itemId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
    if (open && mode === "ensure") return summarize(open);
    if (open) await tx.lostFoundGuestLink.update({ where: { id: open.id }, data: { revokedAt: now, revokedById: actorId } });
    const id = `lfl_${randomBytes(12).toString("hex")}`;
    const tokenSalt = randomBytes(16).toString("base64url");
    const token = guestLinkToken({ id, tokenSalt });
    const expiresAt = guestLinkExpiry({ foundAt: item.createdAt, now, timeZone, settings });
    const link = await tx.lostFoundGuestLink.create({ data: { id, itemId, tokenSalt, tokenHash: hashGuestLinkToken(token), expiresAt, createdById: actorId, createdAt: now } });
    await tx.lostFoundEvent.create({
      data: {
        itemId,
        userId: actorId,
        action: "GUEST_LINK_CREATED",
        note: `${open ? "Guest link renewed; the previous link no longer works." : "Guest link created."} It works until ${expiresAt.toISOString().slice(0, 10)}.`,
        meta: { linkId: link.id, expiresAt: expiresAt.toISOString(), replacedLinkId: open?.id ?? null },
      },
    });
    return summarize(link);
  });
}

export async function revokeGuestLink(itemId: string, actorId: string, now: Date = new Date()): Promise<{ revoked: number }> {
  return db.$transaction(async (tx) => {
    const open = await tx.lostFoundGuestLink.findMany({ where: { itemId, revokedAt: null }, select: { id: true } });
    if (open.length === 0) return { revoked: 0 };
    await tx.lostFoundGuestLink.updateMany({ where: { id: { in: open.map((link) => link.id) } }, data: { revokedAt: now, revokedById: actorId } });
    await tx.lostFoundEvent.create({ data: { itemId, userId: actorId, action: "GUEST_LINK_REVOKED", note: "Guest link switched off. The guest's page now says the link is no longer active.", meta: { linkIds: open.map((link) => link.id) } } });
    return { revoked: open.length };
  });
}

export type ResolvedGuestLink =
  | { state: "open"; link: LostFoundGuestLink; item: LostFoundItem; token: string }
  | { state: "invalid" | "revoked" | "expired" | "disabled" };

export const GUEST_LINK_REFUSALS: Record<Exclude<ResolvedGuestLink["state"], "open">, string> = {
  invalid: "This link is not valid. Please contact the office.",
  revoked: "This link is no longer active. Please contact the office.",
  expired: "This link has expired. Please contact the office for a new one.",
  disabled: "Return requests are not taken online at the moment. Please contact the office.",
};

export async function resolveGuestLink(token: string, now: Date = new Date()): Promise<ResolvedGuestLink> {
  if (!TOKEN_PATTERN.test(token)) return { state: "invalid" };
  const link = await db.lostFoundGuestLink.findUnique({ where: { tokenHash: hashGuestLinkToken(token) } });
  if (!link) return { state: "invalid" };
  if (link.revokedAt) return { state: "revoked" };
  if (link.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  const settings = await readLostFoundSettings();
  if (!settings.publicReturnRequests) return { state: "disabled" };
  const item = await db.lostFoundItem.findUnique({ where: { id: link.itemId } });
  if (!item) return { state: "invalid" };
  return { state: "open", link, item, token };
}

/** Per link and address: 60 requests a minute, 600 an hour. */
export function guestLinkRateLimited(token: string, ip: string): boolean {
  const key = token.slice(0, 12);
  return (
    !rateLimit(`lf-link:min:${key}:${ip}`, { limit: 60, windowMs: 60_000 }).ok ||
    !rateLimit(`lf-link:hour:${key}`, { limit: 600, windowMs: 60 * 60_000 }).ok
  );
}

/** Submissions (new, change, withdraw): 10 an hour per link. */
export function guestSubmitRateLimited(token: string): boolean {
  return !rateLimit(`lf-link:submit:${token.slice(0, 12)}`, { limit: 10, windowMs: 60 * 60_000 }).ok;
}

export type DraftGuestLink = { url: string | null; expiresAt: string | null; photoUrl: string | null; enabled: boolean };

/** For the "Message guest" draft: the open link, the photo URL the email shows, and whether links are on. */
export async function guestLinkForDraft(itemId: string, hasPhoto: boolean, now: Date = new Date()): Promise<DraftGuestLink> {
  const [settings, link] = await Promise.all([
    readLostFoundSettings(),
    db.lostFoundGuestLink.findFirst({ where: { itemId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!link) return { url: null, expiresAt: null, photoUrl: null, enabled: settings.publicReturnRequests };
  const token = guestLinkToken(link);
  return { url: guestLinkUrl(token), expiresAt: link.expiresAt.toISOString(), photoUrl: hasPhoto ? guestPhotoUrl(token) : null, enabled: settings.publicReturnRequests };
}

/** The open link's token and URL for an email, or nulls. */
export async function openLinkToken(itemId: string, now: Date = new Date()): Promise<{ token: string | null; url: string | null }> {
  const link = await db.lostFoundGuestLink.findFirst({ where: { itemId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  if (!link) return { token: null, url: null };
  const token = guestLinkToken(link);
  return { token, url: guestLinkUrl(token) };
}
