import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PayrollProcessConflict, processPayrollRun } from "@/lib/payroll/engine";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";

/**
 * Send a confirmed run's payouts. Administrators only.
 *
 * Tier C since 2026-11-17 (board "Pay run", owner default pending
 * confirmation): the body carries `{ security: { pin } }` (or `{ password }`
 * while the person has no PIN), verified here with
 * verifySensitiveAction("payroll.process") against the actual signed-in
 * person, in the same request; refused while testing as someone else. The run
 * is claimed CONFIRMED → PROCESSING before money moves, so a second request
 * answers 409 instead of processing twice.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => ({}));
    const refusal = await routeSecurityRefusal(session, securityFromBody(body) ?? null, "payroll.process");
    if (refusal) return refusal;
    const result = await processPayrollRun(params.id);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYROLL_RUN_PROCESSED",
        entity: "PayrollRun",
        entityId: params.id,
        after: { status: result.status, successCount: result.successCount, failCount: result.failCount },
      },
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof PayrollProcessConflict) {
      return NextResponse.json({ error: err.message, code: "PAYROLL_PROCESS_CONFLICT" }, { status: 409 });
    }
    const message = err instanceof Error && err.message ? err.message : "Could not process payroll run.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "Payroll run not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
