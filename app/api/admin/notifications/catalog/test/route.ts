import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { sendTestToSelf, TestSendError } from "@/lib/notifications/test-send";
import { requireWordingEditor, WordingForbiddenError } from "@/lib/notifications/wording/permission";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * "Send test to me" for a notification type. ADMIN, or an operations manager
 * with the notifications pack at Manage (owner decision 2026-11-12, the same
 * access as editing wording). The recipient is always the signed-in user;
 * refused while impersonating, so it can never reach the impersonated account
 * or anyone else. Transports are chosen explicitly (inbox, push, email, SMS).
 */
export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "Test sends are disabled while impersonating." }, { status: 403, headers });
    await requireWordingEditor(session);
    const outcomes = await sendTestToSelf(session.user.id, await request.json());
    return NextResponse.json({ outcomes }, { headers });
  } catch (error) {
    if (error instanceof WordingForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers });
    if (error instanceof TestSendError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Choose a notification type and a transport." }, { status: 400, headers });
    return NextResponse.json({ error: "The test could not be sent." }, { status: getApiErrorStatus(error, 500), headers });
  }
}
