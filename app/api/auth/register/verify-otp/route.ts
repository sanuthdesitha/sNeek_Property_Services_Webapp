import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashOtp } from "@/lib/auth/otp";
import {
  clearOtpState,
  ensureOtpNotLocked,
  recordOtpFailure,
  recordOtpSuccess,
} from "@/lib/auth/otp-state";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAuthUserState, upsertAuthUserState } from "@/lib/auth/account-state";
import { resolveAppUrl } from "@/lib/app-url";

const verifyOtpSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  try {
    const body = verifyOtpSchema.parse(await req.json());
    const email = body.email.toLowerCase();
    const identifier = `signup:${email}`;
    const lockStatus = await ensureOtpNotLocked(identifier);
    if (!lockStatus.ok) {
      return NextResponse.json({ error: lockStatus.message }, { status: 429 });
    }

    const record = await db.verificationToken.findFirst({
      where: { identifier },
      orderBy: { expires: "desc" },
    });

    if (!record) {
      return NextResponse.json({ error: "No verification code found. Request a new OTP." }, { status: 404 });
    }

    if (record.expires.getTime() < Date.now()) {
      await db.verificationToken.deleteMany({ where: { identifier } });
      return NextResponse.json({ error: "OTP expired. Request a new code." }, { status: 400 });
    }

    const expected = hashOtp(identifier, body.code);
    if (record.token !== expected) {
      const result = await recordOtpFailure(identifier);
      return NextResponse.json({ error: result.message }, { status: result.locked ? 429 : 400 });
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { isActive: true, emailVerified: new Date() },
      }),
      db.verificationToken.deleteMany({ where: { identifier } }),
    ]);
    await recordOtpSuccess(identifier);
    await clearOtpState(identifier);

    const state = await getAuthUserState(user.id);
    if (!state?.welcomeEmailSent) {
      const settings = await getAppSettings();
      const template = renderEmailTemplate(settings, "welcomeAccount", {
        userName: user.name ?? user.email,
        role: user.role.replace(/_/g, " "),
        actionUrl: resolveAppUrl("/onboarding", req),
        actionLabel: "Complete onboarding",
      });
      const welcomeResult = await sendEmailDetailed({
        to: user.email,
        subject: template.subject,
        html: template.html,
      });
      if (welcomeResult.ok) {
        await upsertAuthUserState(user.id, { welcomeEmailSent: true });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
