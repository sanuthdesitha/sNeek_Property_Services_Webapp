import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadPayoutBreakdown } from "@/lib/payroll/payout-breakdown";

/**
 * GET ?payoutId= — the jobs (with their stored rate snapshots), settled
 * shopping, adjustments and inspections behind one payout of this run. Read
 * only; same roles as the run itself.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const payoutId = new URL(req.url).searchParams.get("payoutId")?.trim();
    if (!payoutId) return NextResponse.json({ error: "Choose a payout." }, { status: 400 });
    const breakdown = await loadPayoutBreakdown(params.id, payoutId);
    if (!breakdown) return NextResponse.json({ error: "Payout not found on this run." }, { status: 404 });
    return NextResponse.json(breakdown, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not read this payout.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "What makes up this payout could not be read." : message }, { status });
  }
}
