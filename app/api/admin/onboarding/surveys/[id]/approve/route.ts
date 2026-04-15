import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { approveSurvey } from "@/lib/onboarding/approval/workflow";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));

    const result = await approveSurvey({
      surveyId: params.id,
      adminReviewerId: session.user.id,
      adminNotes: body.adminNotes ?? null,
      adminOverrides: body.adminOverrides ?? null,
      createJobsForTypes: body.createJobsForTypes,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
