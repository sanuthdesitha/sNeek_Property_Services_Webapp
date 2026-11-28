/**
 * PATCH /api/admin/job-evidence-overrides/[id] — the office decides a
 * "Camera not working" request (cleaner job flow v2, item 2):
 *   { decision: "ALLOW", allowedFieldIds: [...], reason }  or
 *   { decision: "DECLINE", reason }.
 *
 * ADMIN or OPS_MANAGER on the live session. requireRole → requireSession →
 * enforceOpsRequest re-reads the operations policy on this request, so an
 * operations manager also needs the Approvals pack at manage (this path maps
 * to "approvals" in lib/rbac/ops-catalog.ts); ADMIN is not limited by packs.
 * Operations managers have no per-client or per-property job scope. Refused
 * while testing as another person, so the decision names the person who gave
 * it. Decided once; the same decision again is a replay.
 *
 * Allowing waives only the chosen photo questions on that one job, whatever
 * the pilot state (no job is left stuck by a switch).
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { deliverInboxIntentsNow } from "@/lib/notifications/inline-dispatch";
import { decideEvidenceOverride, EvidenceOverrideError } from "@/lib/jobs/evidence-override";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return refuse(403, "Stop testing as another person before you decide.", "IMPERSONATION_NOT_ALLOWED");
    const role = session.user.role === Role.ADMIN ? Role.ADMIN : Role.OPS_MANAGER;
    const body = await req.json().catch(() => null);
    const result = await decideEvidenceOverride({ id: session.user.id, role }, params.id, body);
    const states = result.intentIds.length > 0 ? await deliverInboxIntentsNow(result.intentIds) : new Map();
    const inInbox = Array.from(states.values()).filter((state) => state.state === "inbox_available").length;
    return NextResponse.json(
      {
        outcome: result.outcome,
        id: result.request.id,
        status: result.request.status,
        allowedFieldIds: result.request.allowedFieldIds,
        decidedAt: result.request.decidedAt,
        cleaner: { queued: result.intentIds.length, inInbox },
      },
      { headers: privateHeaders },
    );
  } catch (err) {
    if (err instanceof EvidenceOverrideError) return refuse(err.status, err.message, err.code);
    if (err instanceof ZodError) return refuse(400, "Choose at least one photo to allow and give a reason (at least 5 characters).", "INVALID_INPUT");
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
    if (message === "FORBIDDEN") return refuse(403, "You cannot decide this.", "FORBIDDEN");
    return refuse(500, "Could not save the decision. Try again.", "FAILED");
  }
}
