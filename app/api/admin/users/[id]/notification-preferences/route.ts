import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationChannelPreference } from "@/lib/settings";
import { getUserNotificationPreferences, saveUserNotificationPreferences } from "@/lib/notifications/preferences";
import { recordLegacySwitchChange, topicIdsFor } from "@/lib/notifications/personal/write";

const channelSchema = z.object({
  web: z.boolean().optional(),
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
});

const patchSchema = z.object({
  account: channelSchema.optional(),
  jobs: channelSchema.optional(),
  laundry: channelSchema.optional(),
  cases: channelSchema.optional(),
  reports: channelSchema.optional(),
  quotes: channelSchema.optional(),
  shopping: channelSchema.optional(),
  billing: channelSchema.optional(),
  approvals: channelSchema.optional(),
  ical: channelSchema.optional(),
});

function toRecord(
  value: Partial<Record<NotificationCategory, Partial<NotificationChannelPreference>>>
) {
  const next: Partial<Record<NotificationCategory, Partial<NotificationChannelPreference>>> = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    if (value[category]) next[category] = value[category];
  }
  return next;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const user = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const preferences = await getUserNotificationPreferences(params.id);
    return NextResponse.json(preferences);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load notification preferences." }, { status });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) {
      return NextResponse.json({ error: "Notification switches cannot be changed while testing as someone else." }, { status: 403 });
    }

    const user = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const before = await getUserNotificationPreferences(params.id);
    const preferences = await saveUserNotificationPreferences(params.id, toRecord(body));
    await db.auditLog.create({
      data: { userId: session.user.id, action: "USER_NOTIFICATION_PREFERENCES_SET", entity: "User", entityId: params.id, before: before as object, after: preferences as object },
    });
    await recordLegacySwitchChange(params.id, topicIdsFor(toRecord(body)), { id: session.user.id, name: session.user.name ?? null, role: String(session.user.role) });
    return NextResponse.json(preferences);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save notification preferences." }, { status });
  }
}
