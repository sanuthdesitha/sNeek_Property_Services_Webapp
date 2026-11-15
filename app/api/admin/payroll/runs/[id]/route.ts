import { NextRequest, NextResponse } from "next/server";
import { PayoutStatus, PayrollRunStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { canActAs } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getPayrollRun } from "@/lib/payroll/engine";
import { REASON_REQUIRED_MESSAGE, requiredReason } from "@/lib/confirmations/reasons";
import { routeSecurityRefusal, routeSecuritySchema, securityFromBody } from "@/lib/security/route-verification";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const run = await getPayrollRun(params.id);
    if (!run) return NextResponse.json({ error: "Payroll run not found." }, { status: 404 });
    return NextResponse.json(run);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load payroll run." }, { status });
  }
}

const patchSchema = z
  .object({
    status: z.nativeEnum(PayrollRunStatus).optional(),
    /** The run status the person saw; a different stored status is refused (409). */
    expectedStatus: z.nativeEnum(PayrollRunStatus).optional(),
    reason: z.string().max(2000).optional(),
    payoutId: z.string().trim().min(1).optional(),
    payoutStatus: z.nativeEnum(PayoutStatus).optional(),
    /** The payout status the person saw; a different stored status is refused (409). */
    expectedPayoutStatus: z.nativeEnum(PayoutStatus).optional(),
    security: routeSecuritySchema,
  })
  .refine((v) => v.status || (v.payoutId && v.payoutStatus), { message: "Nothing to update." })
  .refine((v) => !(v.status && v.payoutId), { message: "Change the run or one payout, not both in one request." });

type PatchBody = z.infer<typeof patchSchema>;
type RouteSession = Awaited<ReturnType<typeof requireRole>>;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status });
}

/**
 * One payout's status, for payments made outside the automated flow.
 * Administrators and operations managers (owner default 2026-11-17: as
 * before). Idempotent: asking for the status it already has changes nothing,
 * so a double click cannot move the paid date or write a second history row.
 */
async function changePayoutStatus(session: RouteSession, runId: string, body: PatchBody) {
  const payoutId = body.payoutId!;
  const target = body.payoutStatus!;
  const current = await db.payout.findFirst({ where: { id: payoutId, payrollRunId: runId }, select: { id: true, status: true } });
  if (!current) return json({ error: "Payout not found on this run." }, 404);
  if (current.status === target) return null;
  if (body.expectedPayoutStatus && body.expectedPayoutStatus !== current.status) {
    return json({ error: "This payout changed while you were looking. Reload and check it again.", code: "PAYOUT_CHANGED" }, 409);
  }
  const changed = await db.payout.updateMany({
    where: { id: payoutId, payrollRunId: runId, status: current.status },
    data: { status: target, processedAt: target === PayoutStatus.PAID ? new Date() : null },
  });
  if (changed.count !== 1) {
    return json({ error: "This payout changed while you were looking. Reload and check it again.", code: "PAYOUT_CHANGED" }, 409);
  }
  await db.auditLog.create({
    data: {
      userId: session.impersonation?.actorId ?? session.user.id,
      action: "PAYROLL_STATUS_MANUAL_UPDATE",
      entity: "PayrollRun",
      entityId: runId,
      before: { payoutId, payoutStatus: current.status },
      after: { payoutId, payoutStatus: target, ...(session.impersonation ? { testingAs: session.user.id } : {}) },
    },
  });
  return null;
}

/**
 * The whole run's status, for payments made outside this page (Paid outside
 * the app, Void, Retry after failure → CONFIRMED). Since 2026-11-17: ADMIN
 * only, a required reason, and the person's own PIN verified here
 * (payroll.run_status); refused while testing as someone else. Payout
 * statuses are not changed. Asking for the current status changes nothing.
 */
async function changeRunStatus(session: RouteSession, runId: string, body: PatchBody, raw: unknown) {
  const held = (session.user.heldRoles ?? [session.user.role]) as Role[];
  if (!canActAs(held, [Role.ADMIN])) {
    return json({ error: "Only an administrator can change a pay run's status.", code: "ADMIN_ONLY" }, 403);
  }
  const target = body.status!;
  const current = await db.payrollRun.findUnique({ where: { id: runId }, select: { id: true, status: true } });
  if (!current) return json({ error: "Payroll run not found." }, 404);
  if (current.status === target) return null;
  if (body.expectedStatus && body.expectedStatus !== current.status) {
    return json({ error: "This run changed while you were looking. Reload and check it again.", code: "RUN_CHANGED" }, 409);
  }
  const reason = requiredReason(body.reason);
  if (!reason) return json({ error: REASON_REQUIRED_MESSAGE, code: "REASON_REQUIRED" }, 400);
  const refusal = await routeSecurityRefusal(session, securityFromBody(raw) ?? null, "payroll.run_status");
  if (refusal) return refusal;
  const changed = await db.payrollRun.updateMany({ where: { id: runId, status: current.status }, data: { status: target } });
  if (changed.count !== 1) {
    return json({ error: "This run changed while you were looking. Reload and check it again.", code: "RUN_CHANGED" }, 409);
  }
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAYROLL_STATUS_MANUAL_UPDATE",
      entity: "PayrollRun",
      entityId: runId,
      before: { status: current.status },
      after: { status: target, reason },
    },
  });
  return null;
}

/** Manual status override — a whole run (ADMIN, reason, own PIN) or one payout (ADMIN or OPS_MANAGER). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const raw = await req.json().catch(() => ({}));
    const body = patchSchema.parse(raw);
    const refused = body.status
      ? await changeRunStatus(session, params.id, body, raw)
      : await changePayoutStatus(session, params.id, body);
    if (refused) return refused;
    const run = await getPayrollRun(params.id);
    return NextResponse.json(run);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Nothing to update." }, { status: 400 });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update payroll status." }, { status });
  }
}
