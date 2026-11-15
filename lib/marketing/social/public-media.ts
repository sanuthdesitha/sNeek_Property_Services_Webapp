import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed links to ONE cleaned social copy (2026-11-17), for a network to
 * fetch while it publishes: `/api/public/social-media/<token>`. The token
 * names the derivative and its post, expires (1 hour by default) and is
 * signed with a key derived from NEXTAUTH_SECRET, so it cannot be guessed or
 * altered. The route serves only a stored derivative whose post matches;
 * never an evidence original, never a listing.
 */

export const PUBLIC_MEDIA_PATH = "/api/public/social-media";
const DEFAULT_TTL_SECONDS = 3600;

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to sign social media links.");
  return createHmac("sha256", secret).update("sneek-social-media-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export type MediaClaim = { assetId: string; groupId: string; expiresAt: number };

export function signMediaToken(input: { assetId: string; groupId: string; ttlSeconds?: number; now?: Date }): string {
  const expires = Math.floor((input.now ?? new Date()).getTime() / 1000) + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload = Buffer.from(JSON.stringify({ a: input.assetId, g: input.groupId, e: expires })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The claim, or null when the token is malformed, altered or expired. */
export function verifyMediaToken(token: string, now = new Date()): MediaClaim | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: unknown; g?: unknown; e?: unknown };
    if (typeof body.a !== "string" || typeof body.g !== "string" || typeof body.e !== "number") return null;
    if (body.e * 1000 <= now.getTime()) return null;
    return { assetId: body.a, groupId: body.g, expiresAt: body.e };
  } catch {
    return null;
  }
}

/**
 * The public https address networks fetch from, or why there is none. Meta
 * fetches images from the internet, so a localhost or plain http address
 * cannot work: the owner must set APP_URL to the public https site.
 */
export function publicMediaBase(): { base: string } | { problem: string } {
  const raw = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { problem: "Images must be at a public https address: set APP_URL to the public https address of sNeek." };
  }
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname) || url.hostname.endsWith(".local")) {
    return { problem: "Images must be at a public https address: set APP_URL to the public https address of sNeek (it is not public now)." };
  }
  return { base: url.origin };
}

export function publicMediaUrl(base: string, token: string): string {
  return `${base}${PUBLIC_MEDIA_PATH}/${token}`;
}
