import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { sendEmail } from "@/lib/notifications/email";
import {
  countBackupCodes,
  generateBackupCodes,
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

/** Current 2FA status for the signed-in user. */
export async function GET() {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true, twoFactorMethod: true, twoFactorBackupCodes: true, passwordHash: true, email: true },
  });
  return NextResponse.json({
    enabled: !!user?.twoFactorEnabled,
    method: user?.twoFactorMethod ?? null,
    backupCodesRemaining: countBackupCodes(user?.twoFactorBackupCodes ?? null),
    hasPassword: !!user?.passwordHash,
    email: user?.email ?? null,
  });
}

/** Begin setup for a chosen method. Stores a candidate TOTP secret (not yet
 *  enabled) or emails a verification code. */
export async function POST(req: NextRequest) {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  await sendEmail({
    to: user.email,
    subject: "Confirm two-step verification",
    html: `<p>Your verification code is <strong style="font-size:22px;letter-spacing:2px">${code}</strong></p><p>It expires in 10 minutes.</p>`,
    transactional: true,
  });
  return NextResponse.json({ method });
}

/** Confirm setup with a code → enable 2FA and return one-time backup codes. */
export async function PUT(req: NextRequest) {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const { plain, hashedJson } = generateBackupCodes();
  await db.$transaction([
    db.user.update({
      where: { id: session.user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: method,
        twoFactorBackupCodes: hashedJson,
        // Email method doesn't use a TOTP secret.
        ...(method === "EMAIL" ? { totpSecret: null } : {}),
      },
    }),
    // Re-configuring 2FA (often because the account may be compromised) must
    // invalidate any "remember this device" tokens minted under the old setup —
    // otherwise a previously-trusted device keeps skipping the new second factor.
    db.trustedDevice.deleteMany({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({ ok: true, backupCodes: plain });
}

/** Disable 2FA — requires the account password. Clears trusted devices too. */
export async function DELETE(req: NextRequest) {
  const session = await sessionOr401();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  await db.$transaction([
    db.user.update({
      where: { id: session.user.id },
      data: { twoFactorEnabled: false, twoFactorMethod: null, totpSecret: null, twoFactorBackupCodes: null },
    }),
    db.trustedDevice.deleteMany({ where: { userId: session.user.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
