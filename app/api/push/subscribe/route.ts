import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";

export const runtime = "nodejs";

// A browser PushSubscription serialized via subscription.toJSON().
const subscribeSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(255),
    auth: z.string().trim().min(1).max(255),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = subscribeSchema.parse(await req.json());

    const userAgent = req.headers.get("user-agent")?.slice(0, 255) || null;

    // Upsert by the unique endpoint. If the same endpoint was previously bound
    // to a different user (shared device), re-bind it to the current user.
    const subscription = await db.pushSubscription.upsert({
      where: { endpoint: parsed.endpoint },
      create: {
        userId: session.user.id,
        endpoint: parsed.endpoint,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        userAgent,
        lastUsedAt: new Date(),
      },
      update: {
        userId: session.user.id,
        p256dh: parsed.keys.p256dh,
        auth: parsed.keys.auth,
        userAgent,
        lastUsedAt: new Date(),
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: subscription.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not register push subscription." },
      { status: getApiErrorStatus(err) }
    );
  }
}
