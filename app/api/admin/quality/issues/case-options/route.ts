import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { hubErrorResponse } from "@/lib/quality/http";
import { RaiseIssueError, loadRaiseFromCaseOptions } from "@/lib/quality/raise-from-case";

export const dynamic = "force-dynamic";

/**
 * GET ?caseId= — what "Raise QA issue for cleaner" offers for a case: the
 * job's assigned cleaners, the configured categories, the real severities,
 * photo evidence and issues already raised from the case, plus whether this
 * viewer may raise one (the POST's own rule: ADMIN, or OPS_MANAGER with the
 * quality pack at manage level, not while impersonating).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const caseId = req.nextUrl.searchParams.get("caseId")?.trim() ?? "";
    if (!caseId || caseId.length > 200) return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    const levels = await getOpsAccess(session.user);
    const canRaise = !session.impersonation && (!levels || opsLevelAllows(levels.quality, "POST"));
    const options = await loadRaiseFromCaseOptions(caseId);
    return NextResponse.json({ ...options, canRaise }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RaiseIssueError) return NextResponse.json({ error: error.message }, { status: error.status });
    return hubErrorResponse(error, "Could not load the QA issue options.");
  }
}
