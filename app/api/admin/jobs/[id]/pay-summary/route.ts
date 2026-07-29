import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadJobPaySummary } from "@/lib/finance/job-pay-summary-load";

/**
 * GET /api/admin/jobs/:id/pay-summary — the canonical per-job pay summary
 * (lib/finance/job-pay-summary.ts) for the admin job details "Cleaner pay"
 * card. Read-only; every number comes from the shared lib so this screen can
 * never disagree with the cleaner invoice / payroll.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const summary = await loadJobPaySummary(params.id);
    if (!summary) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
