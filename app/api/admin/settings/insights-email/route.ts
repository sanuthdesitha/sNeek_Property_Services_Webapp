import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  listEligibleRecipients,
  readInsightsEmailLog,
  readInsightsEmailSettings,
  saveInsightsEmailSettings,
} from "@/lib/insights/monthly-email";

/**
 * Monthly Insights email settings (ADMIN only, like the settings destination).
 * GET: settings, the people who may be chosen, and the last months' send log.
 * PUT: save; recipients must come from the eligible list.
 */
function statusFor(message: string): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
    const [settings, eligible, log] = await Promise.all([readInsightsEmailSettings(), listEligibleRecipients(), readInsightsEmailLog()]);
    return NextResponse.json({ settings, eligible, log });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the monthly email settings.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => ({}));
    const settings = await saveInsightsEmailSettings(body, session.user.id);
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the monthly email settings.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
