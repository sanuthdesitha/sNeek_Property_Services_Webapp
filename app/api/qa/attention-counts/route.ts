import { NextResponse } from "next/server";
import { QaAssignmentStatus, QaReworkTransferStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveReworkScope, reworkScopeWhere } from "@/lib/qa/rework-list";

/**
 * GET /api/qa/attention-counts — nav badges for the QA portal.
 *
 * The QA nav previously carried exactly one badge (the CP-6 maintenance entry),
 * so an inspector had to open the queue to discover work waiting for them.
 *
 * SCOPING, which is the accuracy question here: an inspection is this person's
 * problem if it is ASSIGNED to them, IN_PROGRESS by them, or still OPEN and
 * therefore claimable by anyone. Counting only their own would hide the
 * unclaimed backlog the queue page shows; counting every status would badge
 * work that is already finished.
 *
 * Rework counts PENDING transfers in the same scope as the Rework list
 * (lib/qa/rework-list.ts): an inspector's own rework, team-wide for the office.
 *
 * `/v2/qa/reviews`, `/pay` and `/more` carry no badge — records and summaries,
 * not queues. A guessed number is worse than none.
 *
 * FAILURE IS SILENT BY DESIGN — each query degrades to 0, the route answers 200.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
    const userId = session.user.id;
    const viewer = { id: userId, role: session.user.role, heldRoles: session.user.heldRoles ?? null };

    const [inspections, rework] = await Promise.all([
      db.qaAssignment
        .count({
          where: {
            OR: [
              // Unclaimed — anyone can pick it up, so it is on everyone's list.
              { status: QaAssignmentStatus.OPEN },
              // Already this inspector's, and not yet finished.
              {
                assignedToId: userId,
                status: { in: [QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
              },
            ],
          },
        })
        .catch(() => 0),
      db.qaReworkTransfer
        .count({
          where: {
            AND: [
              { status: QaReworkTransferStatus.PENDING },
              reworkScopeWhere(viewer, resolveReworkScope(viewer, null)),
            ],
          },
        })
        .catch(() => 0),
    ]);

    return NextResponse.json({
      counts: {
        "/v2/qa": inspections,
        "/v2/qa/rework": rework,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load counts." }, { status });
  }
}
