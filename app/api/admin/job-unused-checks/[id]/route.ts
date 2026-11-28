/**
 * PATCH /api/admin/job-unused-checks/[id] — the office answers "Looks unused —
 * ask the office" (2026-11-28): { decision, note? } with decision one of
 * CLEAN_AS_NORMAL, LIGHT_REFRESH, DO_NOT_CLEAN.
 *
 * ADMIN or OPS_MANAGER on the live session. requireRole → requireSession →
 * enforceOpsRequest re-reads the operations policy on this request, so an
 * operations manager also needs the Approvals pack at manage (this path maps
 * to "approvals" in lib/rbac/ops-catalog.ts); ADMIN is not limited by packs.
 * Operations managers have no per-client or per-property job scope, so every
 * one with the pack may answer any job's question. Refused while testing as another person, so the answer always names
 * the person who gave it. Answered once; the same answer again is a replay.
 *
 * The answer only records the decision and tells the cleaners on the job. It
 * never cancels, skips, reschedules or re-prices the job, or changes pay.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { deliverInboxIntentsNow } from "@/lib/notifications/inline-dispatch";
import { answerUnusedCheck, UnusedCheckError } from "@/lib/jobs/unused-check";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return refuse(403, "Stop testing as another person before you answer.", "IMPERSONATION_NOT_ALLOWED");
    const role = session.user.role === Role.ADMIN ? Role.ADMIN : Role.OPS_MANAGER;
    const body = await req.json().catch(() => null);
    const result = await answerUnusedCheck({ id: session.user.id, role }, params.id, body);
    const states = result.intentIds.length > 0 ? await deliverInboxIntentsNow(result.intentIds) : new Map();
    const inInbox = Array.from(states.values()).filter((state) => state.state === "inbox_available").length;
    return NextResponse.json(
      {
        outcome: result.outcome,
        id: result.check.id,
        decision: result.check.decision,
        decidedAt: result.check.decidedAt,
        cleaners: { queued: result.intentIds.length, inInbox },
      },
      { headers: privateHeaders },
    );
  } catch (err) {
    if (err instanceof UnusedCheckError) return refuse(err.status, err.message, err.code);
    if (err instanceof ZodError) return refuse(400, "Choose an answer. A note can be up to 2000 characters.", "INVALID_INPUT");
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
    if (message === "FORBIDDEN") return refuse(403, "You cannot answer this.", "FORBIDDEN");
    return refuse(500, "Could not save the answer. Try again.", "FAILED");
  }
}
