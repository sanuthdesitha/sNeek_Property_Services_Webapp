import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { sendInsightsEmailTest } from "@/lib/insights/monthly-email";

/**
 * "Send me this month's so far": the month to date, to the signed-in
 * administrator only (never to the chosen recipients). Not allowed while
 * impersonating: the email would go to someone else's inbox.
 */
export async function POST() {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) throw new Error("FORBIDDEN");
    const outcomes = await sendInsightsEmailTest({ id: session.user.id });
    return NextResponse.json({ outcomes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send the test email.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
