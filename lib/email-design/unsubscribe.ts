import "server-only";
/**
 * One-click unsubscribe for CAMPAIGN emails only (owner default, pending
 * confirmation; Spam Act). The link carries a signed token naming the address
 * and the purpose "marketing"; recording it adds the address to the existing
 * suppression list with reason MARKETING_OPT_OUT, which only the campaign
 * senders read (lib/email/suppression.ts `isMarketingSuppressed`). Job,
 * invoice, account and security email keep going: operational and security
 * mail never carries this link and never reads this reason.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "@/lib/logger";
import { recordMarketingOptOut } from "@/lib/email/suppression";

export const UNSUBSCRIBE_PATH = "/api/public/unsubscribe";

function secret(): string | null {
  const value = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  return value && value.length >= 16 ? value : null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string, key: string): string {
  return base64url(createHmac("sha256", key).update(`unsubscribe:${payload}`).digest());
}

/** A signed marketing-unsubscribe token for one address, or null when no signing secret is configured. */
export function marketingUnsubscribeToken(email: string): string | null {
  const key = secret();
  const address = email.trim().toLowerCase();
  if (!key || !address) return null;
  const payload = base64url(JSON.stringify({ e: address, p: "marketing" }));
  return `${payload}.${sign(payload, key)}`;
}

export function marketingUnsubscribeUrl(email: string, appUrl: string): string | null {
  // Only an absolute link works from an inbox; without one the footer offers replying instead.
  if (!/^https?:\/\//i.test(appUrl)) return null;
  const token = marketingUnsubscribeToken(email);
  return token ? `${appUrl.replace(/\/+$/, "")}${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}` : null;
}

/** The address a token names when its signature is valid and its purpose is marketing; otherwise null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const key = secret();
  if (!key || typeof token !== "string" || token.length > 2000) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(fromBase64url(payload).toString("utf8")) as { e?: unknown; p?: unknown };
    return parsed.p === "marketing" && typeof parsed.e === "string" && parsed.e.includes("@") ? parsed.e : null;
  } catch {
    return null;
  }
}

/**
 * Records the opt-out (idempotent). The suppression row (with its time) is the
 * record; audit rows need a signed-in person, so the log line names only a
 * masked address.
 */
export async function applyMarketingUnsubscribe(token: string, source: "link" | "one-click"): Promise<{ ok: boolean; email: string | null }> {
  const email = verifyUnsubscribeToken(token);
  if (!email) return { ok: false, email: null };
  await recordMarketingOptOut(email);
  const [local, domain] = email.split("@");
  logger.info({ source, address: `${local.slice(0, 1)}***@${domain}` }, "Campaign unsubscribe recorded");
  return { ok: true, email };
}
