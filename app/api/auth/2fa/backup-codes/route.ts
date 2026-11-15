import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { backupCodeStatus, createBackupCodeSet } from "@/lib/auth/backup-codes";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { SENSITIVE_VERIFICATION_TEXT } from "@/lib/security/pin-rules";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Backup codes for two-step sign-in (2026-11-17), the signed-in person's own.
 *
 * GET  → whether codes exist, how many remain and when they were made. Never the codes.
 * POST { security: { pin } | { password } } → "Make new backup codes": a new
 *      set of ten replaces every older code in one commit and is returned
 *      ONCE (only hashes are stored). Tier C: administrators and operations
 *      managers confirm with their own PIN (password while they have none)
 *      through verifySensitiveAction; other accounts with their password.
 *      Refused while testing as someone else and when two-step is off.
 *      Audited as TWO_FACTOR_BACKUP_CODES_CREATED (count, replaced, never a code).
 */
async function sessionOrNull() {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await sessionOrNull();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { twoFactorEnabled: true } });
  const status = user?.twoFactorEnabled ? await backupCodeStatus(session.user.id) : { total: 0, remaining: 0, createdAt: null, olderSet: false };
  return NextResponse.json({ enabled: Boolean(user?.twoFactorEnabled), ...status }, { headers: NO_STORE });
}

async function passwordRefusal(userId: string, security: { password?: string } | undefined): Promise<NextResponse | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const password = typeof security?.password === "string" ? security.password : "";
  if (!user?.passwordHash) return NextResponse.json({ error: "Set an account password first." }, { status: 400, headers: NO_STORE });
  if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 423, headers: NO_STORE });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await sessionOrNull();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (session.impersonation) {
    return NextResponse.json(
      { error: SENSITIVE_VERIFICATION_TEXT.ACTUAL_ACTOR_REQUIRED, code: "ACTUAL_ACTOR_REQUIRED" },
      { status: 403, headers: NO_STORE },
    );
  }
  const userId = session.user.id;
  const user = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
  if (!user?.twoFactorEnabled) {
    return NextResponse.json({ error: "Turn on two-step sign-in first; backup codes come with it." }, { status: 409, headers: NO_STORE });
  }

  const body = await req.json().catch(() => ({}));
  const security = securityFromBody(body);
  const held = session.user.heldRoles ?? [session.user.role];
  const office = held.includes(Role.ADMIN) || held.includes(Role.OPS_MANAGER);
  const refusal = office ? await routeSecurityRefusal(session, security ?? null) : await passwordRefusal(userId, security);
  if (refusal) {
    refusal.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return refusal;
  }

  const created = await db.$transaction(async (tx) => {
    const set = await createBackupCodeSet(tx, userId);
    await tx.auditLog.create({
      data: {
        userId,
        action: "TWO_FACTOR_BACKUP_CODES_CREATED",
        entity: "User",
        entityId: userId,
        after: { reason: "made_new_set", count: set.codes.length, replaced: set.replaced, setId: set.setId },
      },
    });
    return set;
  });

  return NextResponse.json(
    { ok: true, codes: created.codes, createdAt: created.createdAt.toISOString(), remaining: created.codes.length, total: created.codes.length },
    { headers: NO_STORE },
  );
}
