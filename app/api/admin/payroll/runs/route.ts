import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createPayrollRun, listPayrollRuns } from "@/lib/payroll/engine";
import { getAppSettings } from "@/lib/settings";
import { resolvePayPeriod } from "@/lib/payroll/period";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const [runs, settings] = await Promise.all([
      listPayrollRuns({ status: status as any, limit: 50 }),
      getAppSettings(),
    ]);
    return NextResponse.json({ runs, defaultPeriod: resolvePayPeriod(settings.payrollPeriod) });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not list payroll runs." }, { status });
  }
}

const createSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());

    const run = await createPayrollRun({
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      notes: body.notes,
      createdByUserId: session.user.id,
    });

    return NextResponse.json(run, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create payroll run." }, { status });
  }
}
