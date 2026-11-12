import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { checkCalendarMove } from "@/lib/calendar/check-move";
import { checkMoveRequestSchema } from "@/lib/calendar/types";

/**
 * POST /api/admin/calendar/check-move — read-only. Reports what a calendar
 * move would run into (refusals, clashes, roster, booking, notices) and the
 * exact reschedule / assign calls to make. It never writes; the page then
 * calls the existing reschedule and assign endpoints. POST because it carries
 * a body and is only useful to someone who can move jobs.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = checkMoveRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send jobId and toDate." }, { status: 400 });
    const outcome = await checkCalendarMove(parsed.data);
    if (outcome.kind === "not_found") return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (outcome.kind === "invalid") return NextResponse.json({ error: outcome.message }, { status: 400 });
    return NextResponse.json(outcome.result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not check this move." : message }, { status });
  }
}
