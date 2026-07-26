import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRealSession } from "@/lib/auth/session";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { rateLimit, getClientIp } from "@/lib/security/rate-limit";
import {
  TEST_AS_UNLOCK_COOKIE,
  TEST_AS_UNLOCK_MAX_ATTEMPTS,
  TEST_AS_UNLOCK_MINUTES,
  TEST_AS_UNLOCK_WINDOW_MS,
  isTestAsUnlocked,
  signTestAsUnlock,
  testAsUnlockCookieOptions,
  testAsUnlockRateKey,
} from "@/lib/auth/test-as-unlock";

/**
 * Re-auth gate for the "Test as" console.
 *
 *   GET  → { unlocked } for the current admin.
 *   POST { pin?, password? } → verifies with the SAME `verifySensitiveAction`
 *         used by every other sensitive admin mutation (bcrypt against the
 *         admin PIN hash, then the account `passwordHash`), rate-limits to
 *         5 attempts / 15 min per admin, audits both outcomes, and on success
 *         sets the short-lived signed unlock cookie that
 *         POST /api/admin/impersonate then requires.
 *   DELETE → drops the cookie ("lock again").
 *
 * `requireRealSession` (not requireRole) throughout: while impersonating the
 * session role is the target's, and the admin must still be able to reach this.
 */

const schema = z.object({
  pin: z.string().trim().max(32).optional(),
  password: z.string().max(500).optional(),
});

export async function GET() {
  try {
    const session = await requireRealSession();
    if (session.user.role !== Role.ADMIN) {
      return NextResponse.json({ unlocked: false }, { status: 403 });
    }
    const token = cookies().get(TEST_AS_UNLOCK_COOKIE)?.value;
    return NextResponse.json({ unlocked: isTestAsUnlocked(token, session.user.id) });
  } catch {
    return NextResponse.json({ unlocked: false }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRealSession();
  } catch {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  // Only a full admin can ever unlock this — mirrors the impersonate route.
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "PIN_OR_PASSWORD_REQUIRED" }, { status: 400 });
  }
  const { pin, password } = parsed.data;

  const limit = rateLimit(testAsUnlockRateKey(session.user.id), {
    limit: TEST_AS_UNLOCK_MAX_ATTEMPTS,
    windowMs: TEST_AS_UNLOCK_WINDOW_MS,
  });
  if (!limit.ok) {
    await audit(session.user.id, "TEST_AS_UNLOCK_BLOCKED", req, {
      retryAfterSec: limit.retryAfterSec,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "TOO_MANY_ATTEMPTS",
        retryAfterSec: limit.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  try {
    await verifySensitiveAction(session.user.id, { pin, password });
  } catch (err: any) {
    const code = err?.message ?? "INVALID_SECURITY_VERIFICATION";
    await audit(session.user.id, "TEST_AS_UNLOCK_FAILED", req, { reason: code });
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ ok: false, error: code }, { status });
  }

  cookies().set(
    TEST_AS_UNLOCK_COOKIE,
    signTestAsUnlock(session.user.id),
    testAsUnlockCookieOptions(),
  );
  await audit(session.user.id, "TEST_AS_UNLOCK", req, {
    method: pin?.trim() ? "PIN" : "PASSWORD",
    expiresInMinutes: TEST_AS_UNLOCK_MINUTES,
  });

  return NextResponse.json({ ok: true, expiresInMinutes: TEST_AS_UNLOCK_MINUTES });
}

export async function DELETE() {
  try {
    const session = await requireRealSession();
    cookies().set(TEST_AS_UNLOCK_COOKIE, "", testAsUnlockCookieOptions(0));
    await audit(session.user.id, "TEST_AS_UNLOCK_CLEARED", null, {});
  } catch {
    /* clearing a cookie must never fail */
  }
  return NextResponse.json({ ok: true });
}

async function audit(
  userId: string,
  action: string,
  req: NextRequest | null,
  after: Record<string, unknown>,
) {
  await db.auditLog
    .create({
      data: {
        userId,
        action,
        entity: "User",
        entityId: userId,
        after: after as any,
        ipAddress: req ? getClientIp(req) : undefined,
      },
    })
    .catch(() => {
      /* auditing must never break the gate */
    });
}
