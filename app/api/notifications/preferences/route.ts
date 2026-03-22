import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getUserNotificationPreferences, saveUserNotificationPreferences } from "@/lib/notifications/preferences";

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
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const preferences = await saveUserNotificationPreferences(session.user.id, body);
    return NextResponse.json(preferences);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not save preferences." },
      { status: err.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
