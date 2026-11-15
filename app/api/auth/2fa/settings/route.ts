import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { twoStepRequirement } from "@/lib/auth/two-step-policy";
import { sendEmail } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { buildDesignedEmail } from "@/lib/email-design/build-email";
import { backupCodeStatus, createBackupCodeSet, deleteBackupCodes } from "@/lib/auth/backup-codes";
import {
  generateTotpSecret,
  issueEmailTwoFaCode,
  totpKeyUri,
  verifyEmailTwoFaCode,
  verifyTotp,
} from "@/lib/auth/twofactor";

async function sessionOr401() {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Changes are the signed-in person's own: refused while testing as someone else. */
function impersonationRefusal(session: { impersonation?: unknown }) {
  if (!session.impersonation) return null;
  return NextResponse.json({ error: "Stop testing as someone else to change your own two-step sign-in.", code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
}

/** Current 2FA status for the signed-in user. */
export async function GET() {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true, twoFactorMethod: true, passwordHash: true, email: true, twoStepRequiredSince: true },
  });
  const backupCodes = user?.twoFactorEnabled ? await backupCodeStatus(session.user.id) : { total: 0, remaining: 0, createdAt: null, olderSet: false };
  const held = session.user.heldRoles ?? [session.user.role];
  const requirement = twoStepRequirement({
    holdsAdmin: held.includes(Role.ADMIN),
    holdsOpsManager: held.includes(Role.OPS_MANAGER),
    twoFactorEnabled: !!user?.twoFactorEnabled,
    requiredSince: user?.twoStepRequiredSince ?? null,
  });
  return NextResponse.json({
    requirement: requirement.kind === "grace"
      ? { kind: "grace", deadline: requirement.deadline?.toISOString() ?? null }
      : requirement.kind === "setup_required"
        ? { kind: "setup_required", since: requirement.since.toISOString() }
        : requirement,
    enabled: !!user?.twoFactorEnabled,
    method: user?.twoFactorMethod ?? null,
    // Older screens read the count; the profile reads the full status. Never the codes.
    backupCodesRemaining: backupCodes.remaining,
    backupCodes,
    hasPassword: !!user?.passwordHash,
    email: user?.email ?? null,
  }, { headers: NO_STORE });
}

/** Begin setup for a chosen method. Stores a candidate TOTP secret (not yet
 *  enabled) or emails a verification code. */
export async function POST(req: NextRequest) {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const refused = impersonationRefusal(session);
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  const method = body.method === "EMAIL" ? "EMAIL" : body.method === "TOTP" ? "TOTP" : null;
  if (!method) return NextResponse.json({ error: "Choose a method." }, { status: 400 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!user?.email) return NextResponse.json({ error: "Account has no email." }, { status: 400 });

  if (method === "TOTP") {
    const secret = generateTotpSecret();
    // Persist the candidate secret; 2FA stays disabled until confirmed (PUT).
    await db.user.update({ where: { id: session.user.id }, data: { totpSecret: secret } });
    const uri = totpKeyUri(user.email, secret);
    const qr = await QRCode.toDataURL(uri);
    return NextResponse.json({ method, secret, otpauthUri: uri, qr });
  }

  // EMAIL: send a verification code to confirm deliverability.
  const code = await issueEmailTwoFaCode(user.email);
  // Fixed security email (design "twoFactorConfirmCode").
  const content = buildDesignedEmail(await getAppSettings(), "twoFactorConfirmCode", { code, expiryMinutes: "10" });
  await sendEmail({
    to: user.email,
    subject: content.subject,
    html: content.html,
    transactional: true,
    // 2FA enrolment verification code — must never be silenced by audience controls.
    critical: true,
  });
  return NextResponse.json({ method });
}

/**
 * Confirm setup with a code → enable 2FA and return a new set of backup codes,
 * shown once (only their hashes are kept). Re-confirming to switch method
 * makes a new set too; the old codes stop working in the same commit.
 */
export async function PUT(req: NextRequest) {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const refused = impersonationRefusal(session);
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  const method = body.method === "EMAIL" ? "EMAIL" : body.method === "TOTP" ? "TOTP" : null;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!method || !code) return NextResponse.json({ error: "Method and code required." }, { status: 400 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, totpSecret: true },
  });
  if (!user?.email) return NextResponse.json({ error: "Account has no email." }, { status: 400 });

  let verified = false;
  if (method === "TOTP" && user.totpSecret) {
    verified = verifyTotp(code, user.totpSecret);
  } else if (method === "EMAIL") {
    verified = await verifyEmailTwoFaCode(user.email, code);
  }
  if (!verified) return NextResponse.json({ error: "That code is incorrect or expired." }, { status: 400 });

  const userId = session.user.id;
  const created = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: method,
        twoFactorBackupCodes: null,
        // Email method doesn't use a TOTP secret.
        ...(method === "EMAIL" ? { totpSecret: null } : {}),
      },
    });
    // Re-configuring 2FA (often because the account may be compromised) must
    // invalidate any "remember this device" tokens minted under the old setup —
    // otherwise a previously-trusted device keeps skipping the new second factor.
    await tx.trustedDevice.deleteMany({ where: { userId } });
    const set = await createBackupCodeSet(tx, userId);
    await tx.auditLog.create({ data: { userId, action: "OWN_TWO_FACTOR_ENABLED", entity: "User", entityId: userId, after: { method } } });
    await tx.auditLog.create({
      data: { userId, action: "TWO_FACTOR_BACKUP_CODES_CREATED", entity: "User", entityId: userId, after: { reason: "two_step_confirmed", method, count: set.codes.length, replaced: set.replaced, setId: set.setId } },
    });
    return set;
  });

  return NextResponse.json(
    { ok: true, backupCodes: created.codes, backupCodesCreatedAt: created.createdAt.toISOString() },
    { headers: NO_STORE },
  );
}

/** Disable 2FA — requires the account password. Clears trusted devices too. */
export async function DELETE(req: NextRequest) {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const refused = impersonationRefusal(session);
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Set an account password first." }, { status: 400 });
  }
  if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 403 });
  }

  const userId = session.user.id;
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorMethod: null, totpSecret: null, twoFactorBackupCodes: null },
    });
    await tx.trustedDevice.deleteMany({ where: { userId } });
    const removed = await deleteBackupCodes(tx, userId);
    await tx.auditLog.create({ data: { userId, action: "OWN_TWO_FACTOR_DISABLED", entity: "User", entityId: userId } });
    await tx.auditLog.create({ data: { userId, action: "TWO_FACTOR_BACKUP_CODES_DELETED", entity: "User", entityId: userId, after: { reason: "two_step_turned_off", count: removed } } });
  });

  return NextResponse.json({ ok: true });
}
