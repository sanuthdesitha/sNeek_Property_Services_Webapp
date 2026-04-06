import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const assignment = await db.jobAssignment.findFirst({
      where: {
        jobId: params.id,
        userId: session.user.id,
        removedAt: null,
      },
    });
    if (!assignment) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const rows = await listEarlyCheckoutRequests({ jobId: params.id });
    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load requests." }, { status });
  }
}
