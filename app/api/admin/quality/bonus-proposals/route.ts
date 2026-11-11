import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { hubErrorResponse } from "@/lib/quality/http";
import { isQualityQueryError } from "@/lib/quality/period";
import { ManualBonusError, proposeManualQualityBonus } from "@/lib/quality/manual-bonus";

export const dynamic = "force-dynamic";

/**
 * POST: propose a quality bonus by hand for one cleaner (Quality → Cleaners →
 * "Propose bonus"). Creates a PENDING pay adjustment that waits in the
 * existing Approvals queue; nothing is paid until it is approved there.
 *
 * Who: exactly who may create a pay adjustment on POST /api/admin/pay-adjustments
 * (ADMIN; OPS_MANAGER whose payroll pack is at manage level), and, because
 * this route lives in Quality, an operations manager also needs quality at
 * manage (the same pack the middleware applies to this path). Refused while
 * impersonating, so the audit names the real person.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) {
      return NextResponse.json({ error: "Bonuses cannot be proposed while impersonating." }, { status: 403 });
    }
    const levels = await getOpsAccess(session.user);
    if (levels && !opsLevelAllows(levels.payroll, "POST")) {
      return NextResponse.json({ error: "Proposing a bonus needs the payroll permission at manage level." }, { status: 403 });
    }
    if (levels && !opsLevelAllows(levels.quality, "POST")) {
      return NextResponse.json({ error: "Your quality permission is read-only." }, { status: 403 });
    }
    const result = await proposeManualQualityBonus(session.user.id, await req.json());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ManualBonusError) {
      return NextResponse.json({ error: error.message, pending: error.pending }, { status: error.status });
    }
    if (error instanceof ZodError) {
      const first = error.issues[0]?.message;
      return NextResponse.json({ error: first || "Check the amount and reason." }, { status: 400 });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the amount and reason." }, { status: 400 });
    if (isQualityQueryError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    return hubErrorResponse(error, "Could not propose the bonus.");
  }
}
