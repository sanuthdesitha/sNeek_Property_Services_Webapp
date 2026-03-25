import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import {
  isExpoPushToken,
  registerUserPushDevice,
  unregisterUserPushDevice,
} from "@/lib/notifications/mobile-push";

const registerSchema = z.object({
  token: z.string().trim().min(1),
  platform: z.string().trim().min(1).max(40),
  appVersion: z.string().trim().max(80).optional(),
});

const unregisterSchema = z.object({
  token: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = registerSchema.parse(await req.json());
    if (!isExpoPushToken(body.token)) {
      return NextResponse.json({ error: "Invalid Expo push token." }, { status: 400 });
    }

    const device = await registerUserPushDevice(db, {
      userId: session.user.id,
      token: body.token,
      platform: body.platform,
      appVersion: body.appVersion,
    });

    return NextResponse.json({
      ok: true,
      id: device?.id ?? null,
      token: device?.token ?? body.token,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not register mobile push device." },
      { status: getApiErrorStatus(err) }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = unregisterSchema.parse(await req.json().catch(() => ({})));
    if (!isExpoPushToken(body.token)) {
      return NextResponse.json({ error: "Invalid Expo push token." }, { status: 400 });
    }
    await unregisterUserPushDevice(db, session.user.id, body.token);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not unregister mobile push device." },
      { status: getApiErrorStatus(err) }
    );
  }
}
