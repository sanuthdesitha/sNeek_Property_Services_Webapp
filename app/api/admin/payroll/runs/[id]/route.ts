import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
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
