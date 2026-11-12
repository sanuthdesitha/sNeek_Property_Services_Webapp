import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadJobPeekSummary } from "@/lib/jobs/peek-summary";

/**
 * GET /api/admin/jobs/:id/peek — the slim Summary the Jobs list's peek panel
 * shows (client, departing and arriving guests, laundry, charge, people).
 * Same roles as the job detail route. People, Money and Activity load from
 * their existing endpoints only when their tab is opened.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const summary = await loadJobPeekSummary(params.id);
    if (!summary) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json(summary, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load this job." : message }, { status });
  }
}
