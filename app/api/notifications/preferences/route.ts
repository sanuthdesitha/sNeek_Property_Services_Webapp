import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
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

export async function GET() {
  try {
    const session = await requireSession();
    const preferences = await getUserNotificationPreferences(session.user.id);
    return NextResponse.json(preferences);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load preferences." },
      { status: err.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.impersonation) {
      return NextResponse.json({ error: "You are testing as someone else: these switches are read-only." }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const before = await getUserNotificationPreferences(session.user.id);
    const preferences = await saveUserNotificationPreferences(session.user.id, body);
    await db.auditLog.create({
      data: { userId: session.user.id, action: "OWN_NOTIFICATION_PREFERENCES_CHANGED", entity: "User", entityId: session.user.id, before: before as object, after: preferences as object },
    });
    await recordLegacySwitchChange(session.user.id, topicIdsFor(body), { id: session.user.id, name: session.user.name ?? null, role: String(session.user.role) });
    return NextResponse.json(preferences);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not save preferences." },
      { status: err.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
