import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { officeSendDecision } from "@/lib/notifications/office-send-permission";
import { officeReturnPanel } from "@/lib/lost-found/return-decisions";
import { ReturnRequestError } from "@/lib/lost-found/return-requests";

/**
 * GET — the item's guest return requests for the office panel (2026-11-20):
 * every request (changes keep their history), the live job/task state and
 * whether the handover needs a new arrangement, the guest link, the upcoming
 * cleans at the property for the job picker, the configured fees, and whether
 * this person may decide and send to the guest (the Message guest rule:
 * ADMIN, or OPS_MANAGER with the Lost & found pack at manage; never while
 * impersonating). ADMIN and OPS_MANAGER (pack read) may read.
 */
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const decision = await officeSendDecision(session, "guest_message");
    const permission = { allowed: decision.allowed, reason: decision.allowed ? null : decision.reason };
    return NextResponse.json(await officeReturnPanel(params.id, { canDecide: permission, canSendGuest: permission }), { headers });
  } catch (error) {
    if (error instanceof ReturnRequestError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the return requests." : message }, { status, headers });
  }
}
