/**
 * Admin "test as" impersonation — the edge-safe half.
 *
 * WHY A SEPARATE COOKIE (and not a mutated NextAuth JWT):
 * three independent places resolve a user's role, and they don't trust each
 * other — the JWT (`auth-options.ts` jwt callback, written only at sign-in),
 * `validateActiveSession` in middleware.ts, and `requireSession()` in
 * session.ts. The last two both RE-READ the User row from the database and
 * overwrite whatever the token said. So spoofing the token role is not just
 * hacky, it doesn't work: the DB role wins two lines later.
 *
 * Instead the real session is left completely untouched and a second, signed
 * cookie says "this admin is currently looking through <user>'s eyes". Each of
 * the three resolvers layers it on top. Consequences that matter:
 *   - Signing out, session expiry and account deactivation all behave exactly
 *     as before, because the underlying session is still the admin's.
 *   - Dropping the cookie is a complete, instant revert. There is no state to
 *     unwind and nothing to get stuck in.
 *   - The audit trail keeps a real actor: we always know WHICH admin did this.
 *
 * The cookie is a NextAuth-signed JWE (same secret, same crypto as the session
 * cookie), so it cannot be forged or edited client-side, and it carries its own
 * short expiry independent of the session.
 *
 * This module must stay importable from middleware (edge runtime): no Prisma,
 * no node APIs, no `server-only`. Database verification lives in
 * `impersonation-server.ts`.
 */
import { encode, decode } from "next-auth/jwt";
import type { Role } from "@prisma/client";

export const IMPERSONATION_COOKIE = "sneek.test-as";

/**
 * Deliberately short. This is a testing tool, not a way to work as someone
 * else all day — an unattended admin laptop shouldn't stay logged in as a
 * cleaner. Re-entering takes two clicks.
 */
export const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60; // 1 hour

/**
 * READ_ONLY is the default and blocks every state-changing request (see
 * middleware.ts). "See what they see" needs reads only, and a write performed
 * while impersonating would land in production data attributed to the person
 * being impersonated — a cleaner clocking on, an invoice sent, a job submitted.
 * FULL exists because testing a flow end-to-end genuinely requires it, but the
 * admin has to choose it explicitly and it is recorded in the audit row.
 */
export type ImpersonationMode = "READ_ONLY" | "FULL";

export type ImpersonationTicket = {
  /** The real admin. Never changes for the life of the cookie. */
  actorId: string;
  actorEmail: string;
  /** The user being viewed as. */
  targetId: string;
  targetRole: Role;
  mode: ImpersonationMode;
  /** Epoch ms; used for the "started N min ago" display. */
  startedAt: number;
};

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) {
    // Same failure mode as the session cookie itself — refuse rather than
    // silently issuing an unsigned ticket.
    throw new Error("NEXTAUTH_SECRET is required to sign an impersonation ticket");
  }
  return value;
}

export async function signImpersonationTicket(ticket: ImpersonationTicket): Promise<string> {
  return encode({
    token: ticket as unknown as Record<string, unknown>,
    secret: secret(),
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });
}

/**
 * Verifies the signature and shape. Returns null for anything suspect —
 * expired, tampered, wrong secret, or missing fields. Never throws, so a bad
 * cookie degrades to "not impersonating" instead of breaking every request.
 */
export async function readImpersonationTicket(
  raw: string | undefined | null,
): Promise<ImpersonationTicket | null> {
  if (!raw) return null;
  try {
    const decoded = await decode({ token: raw, secret: secret() });
    if (!decoded) return null;
    const { actorId, actorEmail, targetId, targetRole, mode, startedAt } = decoded as Record<
      string,
      unknown
    >;
    if (typeof actorId !== "string" || !actorId) return null;
    if (typeof targetId !== "string" || !targetId) return null;
    if (typeof targetRole !== "string" || !targetRole) return null;
    if (mode !== "READ_ONLY" && mode !== "FULL") return null;
    // An admin viewing as themselves is a no-op that would only confuse the
    // banner and the audit trail.
    if (actorId === targetId) return null;
    return {
      actorId,
      actorEmail: typeof actorEmail === "string" ? actorEmail : "",
      targetId,
      targetRole: targetRole as Role,
      mode,
      startedAt: typeof startedAt === "number" ? startedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function impersonationCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/**
 * Methods that cannot change state. Everything else is refused in READ_ONLY.
 */
export function isReadOnlySafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}
