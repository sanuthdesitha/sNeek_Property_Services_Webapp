import "server-only";
/**
 * Recorded sign-ins and "Sign out everywhere else" (Your profile, 2026-11-16).
 *
 * The app signs people in with JWT session cookies, so before this change it
 * kept no list of sign-ins and could not end one. Now each new sign-in writes
 * a UserSignIn row whose id travels in the token as `sid`, and the NextAuth
 * `session` callback asks `sessionTokenRefusal` on every read of the session:
 *   - a token whose row is revoked is refused;
 *   - a token with no recorded sign-in (issued before this change) is refused
 *     once the person has used "Sign out everywhere else" after it was issued
 *     (User.sessionsValidFrom).
 * A refused token reads as signed out everywhere (getServerSession returns
 * no user), so the check is enforced server-side, not by the browser.
 *
 * Retained-account tokens (lib/auth/retained-context.ts) have their own
 * revocation and are left to it.
 */
import { db } from "@/lib/db";
import { describeUserAgent } from "./user-agent-label";

export type SignInMethod = "PASSWORD" | "PASSKEY";

const ACTIVE_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const USER_AGENT_MAX = 400;

export async function recordSignIn(userId: string, method: SignInMethod, userAgent: string | null): Promise<string | null> {
  try {
    const row = await db.userSignIn.create({
      data: { userId, method, userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null },
      select: { id: true },
    });
    return row.id;
  } catch {
    // A missing record must not stop someone signing in; the session is then
    // listed as "device not recorded" and handled like an older sign-in.
    return null;
  }
}

export type TokenFacts = { userId: string; sid: string | null; issuedAtSeconds: number | null };

export type TokenRefusal = "REVOKED" | "SIGNED_OUT_EVERYWHERE" | null;

/** Pure rule, exported for tests. */
export function tokenRefusalFor(
  facts: TokenFacts,
  record: { revokedAt: Date | null; userId: string } | null,
  sessionsValidFrom: Date | null,
): TokenRefusal {
  if (facts.sid) {
    if (record && record.userId === facts.userId) return record.revokedAt ? "REVOKED" : null;
    // A sid that matches no row of this person is treated like an unrecorded token.
  }
  if (!sessionsValidFrom) return null;
  if (facts.issuedAtSeconds === null) return "SIGNED_OUT_EVERYWHERE";
  return facts.issuedAtSeconds * 1000 < sessionsValidFrom.getTime() ? "SIGNED_OUT_EVERYWHERE" : null;
}

/**
 * Null when the token may be used. Also marks the recorded sign-in active (at
 * most every five minutes). A database failure does not sign anyone out.
 */
export async function sessionTokenRefusal(facts: TokenFacts, now: Date = new Date()): Promise<TokenRefusal> {
  try {
    const user = await db.user.findUnique({
      where: { id: facts.userId },
      select: {
        sessionsValidFrom: true,
        signIns: facts.sid ? { where: { id: facts.sid }, select: { id: true, userId: true, revokedAt: true, lastActiveAt: true } } : false,
      },
    });
    if (!user) return null;
    const record = facts.sid && Array.isArray(user.signIns) ? user.signIns[0] ?? null : null;
    const refusal = tokenRefusalFor(facts, record, user.sessionsValidFrom);
    if (!refusal && record && now.getTime() - record.lastActiveAt.getTime() > ACTIVE_WRITE_INTERVAL_MS) {
      await db.userSignIn.update({ where: { id: record.id }, data: { lastActiveAt: now } }).catch(() => undefined);
    }
    return refusal;
  } catch {
    return null;
  }
}

export type SignedInSession = {
  id: string;
  device: string | null;
  deviceKind: "desktop" | "phone" | "unknown";
  method: SignInMethod;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
};

export type SignedInSessions = {
  sessions: SignedInSession[];
  /** This browser's token carries no recorded sign-in (issued before the list existed). */
  currentUnrecorded: boolean;
  /** Sign-ins from before the list existed cannot be listed one by one. */
  olderSignInsMayExist: boolean;
  sessionsValidFrom: string | null;
};

/** Sessions that have not expired (8-hour tokens) and are not revoked, newest first. */
export async function listSignedInSessions(userId: string, currentSid: string | null, now: Date = new Date()): Promise<SignedInSessions> {
  const cutoff = new Date(now.getTime() - 8 * 60 * 60 * 1000);
  const [rows, user] = await Promise.all([
    db.userSignIn.findMany({
      where: { userId, revokedAt: null, lastActiveAt: { gte: cutoff } },
      orderBy: { lastActiveAt: "desc" },
      take: 20,
      select: { id: true, method: true, userAgent: true, createdAt: true, lastActiveAt: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { sessionsValidFrom: true } }),
  ]);
  const sessions: SignedInSession[] = rows.map((row) => {
    const device = describeUserAgent(row.userAgent);
    return {
      id: row.id,
      device: device.label,
      deviceKind: device.kind,
      method: row.method === "PASSKEY" ? "PASSKEY" : "PASSWORD",
      signedInAt: row.createdAt.toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
      current: row.id === currentSid,
    };
  });
  sessions.sort((a, b) => Number(b.current) - Number(a.current));
  const currentRecorded = Boolean(currentSid && sessions.some((session) => session.current));
  return {
    sessions,
    currentUnrecorded: !currentRecorded,
    olderSignInsMayExist: !user?.sessionsValidFrom,
    sessionsValidFrom: user?.sessionsValidFrom?.toISOString() ?? null,
  };
}

export class SignOutOthersError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Revoke every other recorded sign-in and refuse every unrecorded older token.
 * Needs the current token to carry a recorded sign-in, otherwise the
 * "everything before now" rule would also sign out this browser.
 */
export async function signOutEverywhereElse(userId: string, currentSid: string | null, now: Date = new Date()): Promise<{ revoked: number }> {
  if (!currentSid) {
    throw new SignOutOthersError("This browser signed in before sessions were recorded. Sign out and sign in again, then try once more.", 409);
  }
  return db.$transaction(async (tx) => {
    const current = await tx.userSignIn.findFirst({ where: { id: currentSid, userId, revokedAt: null }, select: { id: true } });
    if (!current) throw new SignOutOthersError("This browser's sign-in is no longer recorded. Sign in again.", 409);
    const result = await tx.userSignIn.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSid } },
      data: { revokedAt: now, revokedById: userId },
    });
    await tx.user.update({ where: { id: userId }, data: { sessionsValidFrom: now } });
    // "Remember this device" tokens skip two-step on the next password sign-in; ending
    // the other sessions ends that shortcut too.
    const trusted = await tx.trustedDevice.deleteMany({ where: { userId } });
    await tx.auditLog.create({
      data: {
        userId,
        action: "SESSIONS_SIGNED_OUT_ELSEWHERE",
        entity: "User",
        entityId: userId,
        after: { revokedSignIns: result.count, trustedDevicesCleared: trusted.count, olderTokensRefusedBefore: now.toISOString() },
      },
    });
    return { revoked: result.count };
  });
}
