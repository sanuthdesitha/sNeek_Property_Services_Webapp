import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { resendJobReminder } from "@/lib/ops/reminders";
import { db } from "@/lib/db";

const schema = z.object({
  jobId: z.string().trim().min(1),
  channel: z.enum(["email", "sms"]),
});

/**
 * Retry a single job's reminder to its assigned cleaner(s) on one channel —
 * lets an admin re-send to just the person who failed instead of re-running the
 * whole batch dispatch.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());

    const result = await resendJobReminder(body.jobId, body.channel);

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "MANUAL_NOTIFICATION_RESEND",
          entity: "NotificationDispatch",
          entityId: body.jobId,
          after: { channel: body.channel, recipients: result.recipients } as any,
          ipAddress:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, recipients: result.recipients });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not resend reminder." }, { status });
  }
}
