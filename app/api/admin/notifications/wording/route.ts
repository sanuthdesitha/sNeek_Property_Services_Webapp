import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { wordingEditDecision } from "@/lib/notifications/wording/permission";
import { readWordingSummaries } from "@/lib/notifications/wording/read";
import { WORDING_HEADERS, wordingErrorResponse } from "@/lib/notifications/wording/route-support";

/**
 * GET: one wording line per catalog type (status, edited, problems, live
 * version) and whether the signed-in user may edit wording. ADMIN and
 * OPS_MANAGER, like the catalog read (ops-pack gating: communications).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [summaries, decision] = await Promise.all([readWordingSummaries(), wordingEditDecision(session)]);
    return NextResponse.json({ summaries, canEdit: decision.allowed, editReason: decision.allowed ? null : decision.reason }, { headers: WORDING_HEADERS });
  } catch (error) {
    return wordingErrorResponse(error, "Could not load notification wording.");
  }
}
