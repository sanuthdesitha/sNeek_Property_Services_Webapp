import { NextRequest, NextResponse } from "next/server";
import { PayoutStatus, PayrollRunStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPayrollRun } from "@/lib/payroll/engine";

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
    payoutId: z.string().trim().min(1).optional(),
    payoutStatus: z.nativeEnum(PayoutStatus).optional(),
  })
  .refine((v) => v.status || (v.payoutId && v.payoutStatus), { message: "Nothing to update." });

/** Manual status override — mark a whole run or an individual payout paid /
 *  pending / failed / etc. for payments made outside the automated flow. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    if (body.payoutId && body.payoutStatus) {
      await db.payout.updateMany({
        where: { id: body.payoutId, payrollRunId: params.id },
        data: {
          status: body.payoutStatus,
          processedAt: body.payoutStatus === PayoutStatus.PAID ? new Date() : null,
        },
      });
    }
    if (body.status) {
      await db.payrollRun.update({ where: { id: params.id }, data: { status: body.status } });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYROLL_STATUS_MANUAL_UPDATE",
        entity: "PayrollRun",
        entityId: params.id,
        after: { status: body.status, payoutId: body.payoutId, payoutStatus: body.payoutStatus } as any,
      },
    });

    const run = await getPayrollRun(params.id);
    return NextResponse.json(run);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update payroll status." }, { status });
  }
}
