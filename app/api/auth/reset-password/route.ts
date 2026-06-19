import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { consumeRecoveryToken } from "@/lib/auth/recovery";
import { upsertAuthUserState } from "@/lib/auth/account-state";

const schema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const { email, token, password } = schema.parse(await req.json());
    const lower = email.toLowerCase();

    const valid = await consumeRecoveryToken("pwreset", lower, token);
    if (!valid) {
      return NextResponse.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email: lower }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Clear any forced-reset flag so they're not bounced after signing in.
    await upsertAuthUserState(user.id, { requiresPasswordReset: false });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    return NextResponse.json({ error: err?.message ?? "Could not reset password." }, { status: 400 });
  }
}
