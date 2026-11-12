import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { applyBulkReschedule, bulkRescheduleRequestSchema, previewBulkReschedule } from "@/lib/jobs/bulk-reschedule";

/**
 * POST /api/admin/jobs/bulk-reschedule — Jobs bulk Reschedule.
 * `mode: "preview"` is read-only (per-job outcome from the Calendar's move
 * check); `mode: "apply"` re-checks and saves each movable job through the
 * existing reschedule service, returning a result per row.
 *
 * Access is not widened: a single reschedule (`/api/admin/phase4/reschedule`)
 * and the Calendar move check belong to the Calendar feature, so an operations
 * manager needs Calendar "manage" here as well as Jobs (checked by the live
 * route guard for this path). Administrators keep full rights.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const levels = await getOpsAccess(session.user);
    if (levels && levels.calendar !== "manage") {
      return NextResponse.json({ error: "Rescheduling needs Calendar access set to Manage." }, { status: 403 });
    }
    const parsed = bulkRescheduleRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Send mode, up to 100 job ids, the new date (YYYY-MM-DD) and an optional time shift in minutes." }, { status: 400 });
    }
    if (parsed.data.mode === "preview") {
      return NextResponse.json({ rows: await previewBulkReschedule(parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ results: await applyBulkReschedule(parsed.data, session.user.id) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not reschedule these jobs." : message }, { status });
  }
}
