import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRealSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { actualActorRefusal } from "@/lib/security/actual-actor";
import {
  SensitiveVerificationError,
  clearAdminPin,
  getAdminPinState,
  setAdminPin,
} from "@/lib/security/admin-verification";
import { rateLimit } from "@/lib/security/rate-limit";
import { PIN_LOCK_MINUTES } from "@/lib/security/pin-rules";

/**
 * The signed-in person's OWN sensitive-action PIN.
 *
 *   GET    → { hasPin, updatedAt, lockedUntil, resetByAdministrator, userId } (never the PIN)
 *   POST   { currentPassword, pin }  → set or change it
 *   DELETE { currentPassword }       → remove it (the next sensitive action asks for a new one)
 *
 * Administrators and operations managers only, as themselves: refused while
 * testing as someone else, so nobody can set or read another person's PIN.
 * Setting and removing need the current password, are rate-limited per person
 * (5 per 15 minutes, on top of the shared wrong-attempt lockout) and audited
 * without the PIN.
 */

const CHANGE_LIMIT = { limit: 5, windowMs: PIN_LOCK_MINUTES * 60_000 };

class PinRouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function ownAccount(): Promise<string> {
  const session = await requireRealSession();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, extraRoles: { select: { role: true } } },
  });
  const roles = [user?.role, ...(user?.extraRoles ?? []).map((row) => row.role)];
  if (!roles.includes(Role.ADMIN) && !roles.includes(Role.OPS_MANAGER)) throw new PinRouteError("FORBIDDEN", 403);
  const refusal = await actualActorRefusal(session.user.id);
  if (refusal === "UNAUTHORIZED") throw new PinRouteError("UNAUTHORIZED", 401);
  if (refusal) throw new PinRouteError("Stop testing as someone else to change your own PIN.", 403);
  return session.user.id;
}

function failure(err: unknown, fallback: string) {
  if (err instanceof PinRouteError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof SensitiveVerificationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "PIN_LOCKED" ? 429 : 400 });
  }
  const message = err instanceof Error && err.message ? err.message : fallback;
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

function limited(userId: string) {
  const limit = rateLimit(`own-pin-change:${userId}`, CHANGE_LIMIT);
  if (limit.ok) return null;
  return NextResponse.json(
    { error: `Too many PIN changes. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.` },
    { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
  );
}

export async function GET() {
  try {
    const userId = await ownAccount();
    // `userId` lets a page lock remember an unlock for this person only.
    return NextResponse.json({ ...(await getAdminPinState(userId)), userId });
  } catch (err) {
    return failure(err, "Could not load your PIN.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await ownAccount();
    const tooMany = limited(userId);
    if (tooMany) return tooMany;
    const body = (await req.json().catch(() => ({}))) as { currentPassword?: unknown; pin?: unknown };
    if (typeof body.currentPassword !== "string" || !body.currentPassword.trim()) throw new PinRouteError("Current password is required.", 400);
    await setAdminPin(userId, typeof body.pin === "string" ? body.pin : "", body.currentPassword);
    return NextResponse.json({ ok: true, ...(await getAdminPinState(userId)) });
  } catch (err) {
    return failure(err, "Could not save your PIN.");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await ownAccount();
    const tooMany = limited(userId);
    if (tooMany) return tooMany;
    const body = (await req.json().catch(() => ({}))) as { currentPassword?: unknown };
    if (typeof body.currentPassword !== "string" || !body.currentPassword.trim()) throw new PinRouteError("Current password is required.", 400);
    await clearAdminPin(userId, body.currentPassword);
    return NextResponse.json({ ok: true, ...(await getAdminPinState(userId)) });
  } catch (err) {
    return failure(err, "Could not remove your PIN.");
  }
}
