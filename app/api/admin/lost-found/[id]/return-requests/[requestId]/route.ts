import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { OfficeSendDenied, requireOfficeSend } from "@/lib/notifications/office-send-permission";
import { approveReturnRequest, completeReturnRequest, declineReturnRequest } from "@/lib/lost-found/return-decisions";
import { ReturnRequestError } from "@/lib/lost-found/return-requests";

/**
 * POST — the office's decision on one guest return request (2026-11-20).
 *
 * { action: "approve" | "decline", version, decisionKey, …, message } — the
 * Message guest rule (ADMIN, or OPS_MANAGER with the Lost & found pack at
 * manage and the Message guests capability; never while impersonating). The
 * message is the exact text the office saw; it is sent only when `message.send`
 * names a transport, and its text and the provider's answer go on the timeline.
 * A retry with the same decision key answers from the record.
 *
 * { action: "complete", version, note, trackingReference? } — mark an approved
 * return done by hand (post, drop-off, another time, something else): ADMIN or
 * OPS_MANAGER with the pack at manage (live session guard).
 */
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(req: NextRequest, { params }: { params: { id: string; requestId: string } }) {
  try {
    const body = (await req.json()) as { action?: unknown } | null;
    if (body?.action === "complete") {
      const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
      const request = await completeReturnRequest(params.id, params.requestId, body, { id: session.user.id, role: session.user.role === Role.ADMIN ? "ADMIN" : "OPS_MANAGER", name: session.user.name ?? "The office" });
      return NextResponse.json({ request }, { headers });
    }
    const { session, actor } = await requireOfficeSend("guest_message");
    const decisionActor = { id: actor.id, role: actor.role, name: session.user.name ?? "The office" };
    const permission = { allowed: true, reason: null };
    const result = body?.action === "decline"
      ? await declineReturnRequest(params.id, params.requestId, body, decisionActor, permission)
      : await approveReturnRequest(params.id, params.requestId, body, decisionActor, permission);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof OfficeSendDenied) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ReturnRequestError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the decision and the message." }, { status: 400, headers });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the decision and the message." }, { status: 400, headers });
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The decision was not saved." : message }, { status, headers });
  }
}
