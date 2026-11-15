import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { upsertAuthUserState } from "@/lib/auth/account-state";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Your own password only: never another person's while testing as them.
    if (session.impersonation) {
      return NextResponse.json({ error: "Stop testing as someone else to change your own password.", code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
    }
    const { currentPassword, newPassword } = schema.parse(await req.json());

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Password login is not configured for this account." }, { status: 400 });
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });
    await upsertAuthUserState(user.id, { requiresPasswordReset: false });

    // Revoke all "remember this device" 2FA tokens so a device the user is
    // trying to lock out can no longer skip 2FA. (Passkeys are a deliberate
    // second factor the user set up, so they're intentionally left in place.)
    await db.trustedDevice.deleteMany({ where: { userId: user.id } });
    await db.auditLog.create({ data: { userId: user.id, action: "OWN_PASSWORD_CHANGED", entity: "User", entityId: user.id } });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
