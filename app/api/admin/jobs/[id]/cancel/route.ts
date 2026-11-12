import { NextRequest, NextResponse } from "next/server";
import { capabilityRefusal } from "@/lib/rbac/capability-http";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { cancelJobAndNotify } from "@/lib/jobs/cancel-flow";
import { cancelActor, cancelBodySchema, cancelFailure } from "@/lib/jobs/cancel-http";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/jobs/:id/cancel  { reason, expectedUpdatedAt?, notify? }
 * ADMIN and OPS_MANAGER (an operations manager also needs the Jobs pack at
 * manage, enforced by the live session guard). A started job needs ADMIN.
 * Rules and refusals: lib/jobs/cancel-rules.ts and lib/jobs/cancel.ts.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = await capabilityRefusal(session, ["jobs.cancel"]);
    if (refusal) return refusal;
    const body = cancelBodySchema.parse(await req.json().catch(() => null));
    const result = await cancelJobAndNotify(params.id, body, cancelActor(session));
    return NextResponse.json({
      jobId: result.jobId,
      status: "CANCELLED",
      previousStatus: result.previousStatus,
      cancelledAt: result.cancelledAt.toISOString(),
      released: result.released.map((row) => ({ userId: row.userId, name: row.name ?? row.email })),
      notices: result.notices,
      noticeError: result.noticeError,
      followUps: result.followUps,
    });
  } catch (err) {
    return cancelFailure(err, "Could not cancel the job.");
  }
}
