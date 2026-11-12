import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { restoreJobAndNotify, restoreSlotConflicts } from "@/lib/jobs/cancel-flow";
import { cancelActor, cancelFailure, restoreBodySchema } from "@/lib/jobs/cancel-http";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/jobs/:id/restore  { confirmConflicts?, skipUserIds?, expectedUpdatedAt? }
 * ADMIN and OPS_MANAGER (Jobs pack at manage for an operations manager, as for
 * any scheduling change). Returns a cancelled job to the unstarted status it
 * was cancelled from, with its released cleaners. When the slot check finds a
 * conflict (leave, clash, outside the roster, day passed) it answers 409
 * RESTORE_CONFLICT with each one; resend with confirmConflicts to restore
 * anyway, or with skipUserIds to leave those cleaners off.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = restoreBodySchema.parse(await req.json().catch(() => ({})));
    if (!body.confirmConflicts) {
      const skip = new Set(body.skipUserIds ?? []);
      const conflicts = (await restoreSlotConflicts(params.id)).filter((row) => !row.userId || !skip.has(row.userId));
      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: conflicts.map((row) => (row.name ? `${row.name}: ${row.reason}` : row.reason)).join("; "), code: "RESTORE_CONFLICT", conflicts },
          { status: 409 },
        );
      }
    }
    const result = await restoreJobAndNotify(params.id, cancelActor(session), { skipUserIds: body.skipUserIds, expectedUpdatedAt: body.expectedUpdatedAt });
    return NextResponse.json({
      jobId: result.jobId,
      status: result.status,
      restoredUserIds: result.restoredUserIds,
      notRestored: result.notRestored,
      notices: result.notices,
      noticeError: result.noticeError,
    });
  } catch (err) {
    return cancelFailure(err, "Could not restore the job.");
  }
}
