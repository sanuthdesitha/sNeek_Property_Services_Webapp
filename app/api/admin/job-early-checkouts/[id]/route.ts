import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  cancelEarlyCheckoutRequest,
  decideEarlyCheckoutRequest,
} from "@/lib/jobs/early-checkout-requests";

const schema = z.object({
  status: z.enum(["APPROVED", "DECLINED", "CANCELLED"]).optional(),
  action: z.enum(["cancel"]).optional(),
  decisionNote: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    // Approve/Decline must actually decide the request (which writes the new
    // start/due time onto the job). Previously this route always cancelled,
    // so an approved timing change silently never took effect.
    let updated;
    if (body.status === "CANCELLED" || body.action === "cancel") {
      updated = await cancelEarlyCheckoutRequest({ id: params.id, cancelledById: session.user.id });
    } else if (body.status === "APPROVED" || body.status === "DECLINED") {
      updated = await decideEarlyCheckoutRequest({
        id: params.id,
        decidedById: session.user.id,
        decision: body.status === "APPROVED" ? "APPROVE" : "DECLINE",
        decisionNote: body.decisionNote ?? null,
      });
    } else {
      return NextResponse.json({ error: "A decision status is required." }, { status: 400 });
    }
    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update request." }, { status });
  }
}
