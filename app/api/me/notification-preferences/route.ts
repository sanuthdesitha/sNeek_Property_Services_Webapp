import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationChannelPreference } from "@/lib/settings";
import { getUserNotificationPreferences, saveUserNotificationPreferences } from "@/lib/notifications/preferences";
import { recordLegacySwitchChange, topicIdsFor } from "@/lib/notifications/personal/write";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

const channelSchema = z.object({ web: z.boolean().optional(), email: z.boolean().optional(), sms: z.boolean().optional() }).strict();

const patchSchema = z
  .object(Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, channelSchema.optional()])) as Record<NotificationCategory, z.ZodOptional<typeof channelSchema>>)
  .strict();

/**
 * The signed-in office user's OWN notification switches (Your profile ›
 * Notifications to you). The same stored preferences as their panel in
 * Notifications › People (/api/admin/users/[id]/notification-preferences), so
 * a change in one shows in the other. Never another person's: there is no id
 * in the URL or body. Refused while testing as someone else. A ticked route is
 * what we try; it is not a delivery claim.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ impersonating: true }, { headers });
    const [preferences, user] = await Promise.all([
      getUserNotificationPreferences(session.user.id),
      db.user.findUnique({ where: { id: session.user.id }, select: { phone: true } }),
    ]);
    return NextResponse.json({ impersonating: false, preferences, hasPhone: Boolean(user?.phone?.trim()), phone: user?.phone ?? null }, { headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Your notification switches could not be loaded." : (err as Error).message }, { status, headers });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) {
      return NextResponse.json({ error: "Stop testing as someone else to change your own settings.", code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403, headers });
    }
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "That change could not be read." }, { status: 400, headers });
    const patch = parsed.data as Partial<Record<NotificationCategory, Partial<NotificationChannelPreference>>>;
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { phone: true } });
    const turnsOnSms = Object.values(patch).some((value) => value?.sms === true);
    if (turnsOnSms && !user?.phone?.trim()) {
      return NextResponse.json({ error: "Add a mobile number in Details first." }, { status: 400, headers });
    }
    const before = await getUserNotificationPreferences(session.user.id);
    const preferences = await saveUserNotificationPreferences(session.user.id, patch);
    await db.auditLog.create({
      data: { userId: session.user.id, action: "OWN_NOTIFICATION_PREFERENCES_CHANGED", entity: "User", entityId: session.user.id, before: before as object, after: preferences as object },
    });
    await recordLegacySwitchChange(session.user.id, topicIdsFor(patch), { id: session.user.id, name: session.user.name ?? null, role: String(session.user.role) });
    return NextResponse.json({ impersonating: false, preferences, hasPhone: Boolean(user?.phone?.trim()), phone: user?.phone ?? null }, { headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Your change was not saved. Try again." : (err as Error).message }, { status, headers });
  }
}
