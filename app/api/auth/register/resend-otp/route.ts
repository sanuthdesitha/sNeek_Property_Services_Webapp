import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { issueSignupOtp } from "@/lib/auth/registration-otp";

const resendOtpSchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(req: NextRequest) {
  try {
    const body = resendOtpSchema.parse(await req.json());
    const email = body.email.toLowerCase();

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true, isActive: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    if (user.emailVerified && user.isActive) {
      return NextResponse.json({ error: "Account is already verified." }, { status: 400 });
    }

    const sent = await issueSignupOtp(email, { enforceCooldown: true });
    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: 429 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
