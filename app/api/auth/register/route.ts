import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { registerSchema } from "@/lib/validations/user";
import { issueSignupOtp } from "@/lib/auth/registration-otp";
import { upsertAuthUserState } from "@/lib/auth/account-state";

export async function POST(req: NextRequest) {
  try {
    const payload = registerSchema.parse(await req.json());
    const email = payload.email.toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.emailVerified) {
        return NextResponse.json({ error: "Email is already registered." }, { status: 409 });
      }
      const otp = await issueSignupOtp(email, { enforceCooldown: true });
      if (!otp.ok) {
        return NextResponse.json({ error: otp.error }, { status: 429 });
      }
      return NextResponse.json(
        {
          ok: true,
          requiresVerification: true,
          email,
          message: "Account exists but is not verified. A new OTP has been sent.",
        },
        { status: 202 }
      );
    }

    let clientId: string | undefined;
    if (payload.role === "CLIENT") {
      const existingClient = await db.client.findFirst({
        where: { email, isActive: true },
        select: { id: true },
      });
      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const newClient = await db.client.create({
          data: {
            name: payload.clientName ?? payload.name,
            email,
            phone: payload.phone || undefined,
            address: payload.clientAddress || undefined,
          },
          select: { id: true },
        });
        clientId = newClient.id;
      }
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const user = await db.user.create({
      data: {
        name: payload.name,
        email,
        passwordHash,
        role: payload.role,
        phone: payload.phone || undefined,
        isActive: false,
        clientId,
      },
      select: { id: true, email: true, role: true },
    });
    await upsertAuthUserState(user.id, {
      requiresOnboarding: true,
      tutorialSeen: false,
      requiresPasswordReset: false,
      welcomeEmailSent: false,
    });

    const otp = await issueSignupOtp(email);
    if (!otp.ok) {
      await db.user.delete({ where: { id: user.id } });
      return NextResponse.json({ error: otp.error }, { status: 502 });
    }

    return NextResponse.json(
      {
        ok: true,
        user,
        requiresVerification: true,
        email,
        message: "Account created. Check your email for the OTP code.",
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
