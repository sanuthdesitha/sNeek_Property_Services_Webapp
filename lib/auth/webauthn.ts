import "server-only";
import crypto from "crypto";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { db } from "@/lib/db";

/**
 * Shared WebAuthn (passkey / platform biometric) helpers.
 *
 * - rpID is the bare hostname (no scheme/port) so platform authenticators on
 *   Android + iOS validate it correctly. origin is the full scheme+host(+port)
 *   the request actually arrived on. Both are derived from request headers so
 *   the same code works on localhost and on the live domain.
 * - The ceremony challenge is stashed in a short-lived, httpOnly, signed cookie.
 *   We sign with the app's NEXTAUTH_SECRET (HMAC) so a tampered cookie is
 *   rejected, and the cookie is single-use (we clear it after a verify attempt).
 */

export const WEBAUTHN_RP_NAME = "sNeek Property Services";

export const REGISTER_CHALLENGE_COOKIE = "sneek-wa-reg";
export const AUTHENTICATE_CHALLENGE_COOKIE = "sneek-wa-auth";
export const CHALLENGE_TTL_SECONDS = 300; // 5 minutes — challenges are short-lived.

type HeaderLike = {
  get(name: string): string | null | undefined;
};

function readHeader(headers: HeaderLike | Record<string, any>, name: string): string {
  // Supports both the standard Headers object (route handlers) and the plain
  // record NextAuth hands to authorize() (lower-cased keys).
  if (typeof (headers as HeaderLike).get === "function") {
    const value = (headers as HeaderLike).get(name);
    return typeof value === "string" ? value : "";
  }
  const record = headers as Record<string, any>;
  const direct = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(direct)) return String(direct[0] ?? "");
  return typeof direct === "string" ? direct : "";
}

function firstValue(headerValue: string): string {
  return headerValue.split(",")[0]?.trim() ?? "";
}

/**
 * Derive the relying-party identity from the inbound request headers.
 * Works behind proxies (x-forwarded-*) and on bare localhost.
 */
export function getRelyingParty(headers: HeaderLike | Record<string, any>): {
  rpID: string;
  origin: string;
} {
  const forwardedProto = firstValue(readHeader(headers, "x-forwarded-proto"));
  const forwardedHost = firstValue(readHeader(headers, "x-forwarded-host"));
  const rawHost = forwardedHost || firstValue(readHeader(headers, "host"));
  const protocol = (forwardedProto || "http").replace(/:$/, "");

  // host may include a port (localhost:3000) — strip it for rpID.
  const hostname = rawHost.replace(/:\d+$/, "").trim() || "localhost";
  const origin = rawHost ? `${protocol}://${rawHost}` : `${protocol}://${hostname}`;

  return { rpID: hostname, origin };
}

function getSigningKey(): string {
  return (
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    // Last-resort fallback so we never throw at import time; real deployments
    // always set NEXTAUTH_SECRET (it is required for sessions anyway).
    "sneek-webauthn-dev-secret"
  );
}

/**
 * Encode a challenge into a tamper-evident cookie value: base64url(challenge).hmac
 */
export function encodeChallengeCookie(challenge: string): string {
  const payload = Buffer.from(challenge, "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/**
 * Decode + verify a challenge cookie value. Returns null if missing/tampered.
 */
export function decodeChallengeCookie(value: string | undefined | null): string | null {
  if (!value || typeof value !== "string") return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
  // Constant-time comparison.
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) {
    return null;
  }
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Parse a raw Cookie header string into a lookup of name -> value.
 */
export function parseCookieHeader(cookieHeader: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(val);
  }
  return out;
}

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith("https://");
}

/**
 * Cookie options shared by both ceremony cookies. secure only on https so
 * localhost http still works.
 */
export function challengeCookieOptions(origin: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: isSecureOrigin(origin),
    maxAge: CHALLENGE_TTL_SECONDS,
  };
}

/**
 * Derive a friendly device name from a User-Agent string, e.g. "iPhone (Safari)".
 */
export function deviceNameFromUserAgent(userAgent: string | undefined | null): string {
  const ua = (userAgent || "").trim();
  if (!ua) return "Trusted device";

  let platform = "Device";
  if (/iPhone/i.test(ua)) platform = "iPhone";
  else if (/iPad/i.test(ua)) platform = "iPad";
  else if (/Android/i.test(ua)) platform = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = "Mac";
  else if (/Windows/i.test(ua)) platform = "Windows";
  else if (/CrOS/i.test(ua)) platform = "Chromebook";
  else if (/Linux/i.test(ua)) platform = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/CriOS/i.test(ua)) browser = "Chrome";
  else if (/FxiOS|Firefox/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua)) browser = "Safari";

  // Windows Hello / platform authenticator hint.
  if (platform === "Windows") return browser ? `Windows Hello (${browser})` : "Windows Hello";
  return browser ? `${platform} (${browser})` : platform;
}

function parseStoredTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as AuthenticatorTransportFuture[];
  } catch {
    return value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean) as AuthenticatorTransportFuture[];
  }
  return undefined;
}

export type WebAuthnVerifiedUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: string;
};

/**
 * Re-verify a WebAuthn assertion server-side and, on success, bump the stored
 * counter + lastUsedAt and return the owning user. Used by BOTH the
 * authenticate/verify route AND the NextAuth "webauthn" CredentialsProvider's
 * authorize(), so there is no trust gap: the session is only established after
 * a real @simplewebauthn verification against the stored public key.
 *
 * Returns null on any failure (unknown credential, bad signature, replay, etc).
 */
export async function verifyAssertionAndGetUser(params: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
}): Promise<WebAuthnVerifiedUser | null> {
  const { response, expectedChallenge, expectedOrigin, expectedRPID } = params;

  const credentialId =
    typeof response?.id === "string" && response.id ? response.id : response?.rawId;
  if (!credentialId) return null;

  const stored = await db.webAuthnCredential.findUnique({
    where: { credentialId },
    include: {
      user: {
        select: { id: true, email: true, name: true, image: true, role: true, isActive: true },
      },
    },
  });
  if (!stored || !stored.user || !stored.user.isActive) return null;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
      authenticator: {
        credentialID: new Uint8Array(Buffer.from(stored.credentialId, "base64url")),
        credentialPublicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: Number(stored.counter),
        transports: parseStoredTransports(stored.transports),
      },
    });
  } catch {
    return null;
  }

  if (!verification.verified) return null;

  const newCounter = verification.authenticationInfo.newCounter;
  await db.webAuthnCredential.update({
    where: { id: stored.id },
    data: {
      counter: BigInt(newCounter),
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(),
    },
  });

  return {
    id: stored.user.id,
    email: stored.user.email,
    name: stored.user.name,
    image: stored.user.image,
    role: String(stored.user.role),
  };
}
