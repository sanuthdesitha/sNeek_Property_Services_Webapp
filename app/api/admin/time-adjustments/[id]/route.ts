import { NextRequest, NextResponse } from "next/server";
import { Role, TimeAdjustmentStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { reviewTimeAdjustmentRequest } from "@/lib/time/adjustment-requests";

const updateSchema = z.object({
  status: z.union([z.literal(TimeAdjustmentStatus.APPROVED), z.literal(TimeAdjustmentStatus.REJECTED)]),
  approvedDurationM: z.number().int().min(1).max(24 * 60).optional(),
  adminNote: z.string().trim().max(4000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const updated = await reviewTimeAdjustmentRequest({
      id: params.id,
      reviewerUserId: session.user.id,
      status: body.status,
      approvedDurationM: body.approvedDurationM,
      adminNote: body.adminNote,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "Time adjustment request not found."
            ? 404
            : err.message === "This time adjustment request has already been reviewed."
            ? 409
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
