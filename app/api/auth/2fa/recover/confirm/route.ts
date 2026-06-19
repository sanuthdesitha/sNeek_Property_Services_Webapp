import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { consumeRecoveryToken } from "@/lib/auth/recovery";

const schema = z.object({ email: z.string().email(), token: z.string().min(10) });

/** Consume a 2FA-disable recovery token → turn off 2FA + clear trusted devices. */
export async function POST(req: NextRequest) {
  try {
    const { email, token } = schema.parse(await req.json());
    const lower = email.toLowerCase();

    const valid = await consumeRecoveryToken("2fa-disable", lower, token);
    if (!valid) {
      return NextResponse.json({ error: "This recovery link is invalid or has expired. Request a new one." }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email: lower }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 400 });

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorMethod: null, totpSecret: null, twoFactorBackupCodes: null },
      }),
      db.trustedDevice.deleteMany({ where: { userId: user.id } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not complete recovery." }, { status: 400 });
  }
}
