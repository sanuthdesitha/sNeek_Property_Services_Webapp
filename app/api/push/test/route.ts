import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { isWebPushConfigured, sendWebPushToUser } from "@/lib/notifications/web-push";

export const runtime = "nodejs";

/**
 * Admin-only: send a test Web Push to the current admin's own devices so the
 * owner can verify browser/PWA push is working end-to-end.
 */
export async function POST() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    if (!(await isWebPushConfigured())) {
      return NextResponse.json(
        { ok: false, error: "Web Push is not configured (VAPID keys missing)." },
        { status: 503 }
      );
    }

    const count = await db.pushSubscription.count({ where: { userId: session.user.id } });
    if (count === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No browser/PWA push subscriptions found for your account. Enable notifications first.",
        },
        { status: 409 }
      );
    }

    await sendWebPushToUser(session.user.id, {
      title: "sNeek test notification",
      body: "If you can see this, web push is working on this device.",
      url: "/admin/notifications",
      tag: "sneek-test-push",
    });

    return NextResponse.json({ ok: true, devices: count });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not send test push." },
      { status: getApiErrorStatus(err) }
    );
  }
}
