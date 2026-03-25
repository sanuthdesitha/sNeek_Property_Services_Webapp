import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getSmsProviderState, sendSmsDetailed } from "@/lib/notifications/sms";
import { db } from "@/lib/db";
import { Role, NotificationChannel, NotificationStatus } from "@prisma/client";
import { z } from "zod";

const schema = z.object({
  to: z.string().trim().min(1, "Recipient is required"),
  channel: z.nativeEnum(NotificationChannel).default(NotificationChannel.EMAIL),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { to, channel } = schema.parse(await req.json());

    let ok = false;
    let errorMsg: string | undefined;

    if (channel === NotificationChannel.EMAIL) {
      if (!process.env.RESEND_API_KEY) {
        throw new Error("RESEND_NOT_CONFIGURED");
      }
      z.string().email("Invalid email address").parse(to);
      const emailResult = await sendEmailDetailed({
        to,
        subject: "sNeek Property Services - Test notification",
        html: "<p>This is a test notification from <strong>sNeek Property Services</strong>.</p>",
      });
      ok = emailResult.ok;
      if (!ok) errorMsg = emailResult.error ?? "Email provider failed to send.";
    } else if (channel === NotificationChannel.SMS) {
      const providerState = await getSmsProviderState();
      if (providerState.provider === "none") {
        throw new Error("SMS_DISABLED");
      }
      if (!providerState.configured) {
        throw new Error("SMS_PROVIDER_NOT_CONFIGURED");
      }
      z
        .string()
        .regex(/^\+\d{8,15}$/, "SMS recipient must be in E.164 format, e.g. +61400000000")
        .parse(to);

      const smsResult = await sendSmsDetailed(to, "sNeek Property Services: This is a test SMS notification.");
      ok = smsResult.ok;
      if (!ok) errorMsg = smsResult.error ?? "SMS provider failed to send.";
    }

    await db.notification.create({
      data: {
        userId: session.user.id,
        channel,
        subject: "Test notification",
        body: `Test sent to ${to}`,
        status: ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: ok ? new Date() : undefined,
        errorMsg,
      },
    });

    if (!ok) {
      return NextResponse.json({ ok: false, error: errorMsg ?? "Notification provider failed." }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

