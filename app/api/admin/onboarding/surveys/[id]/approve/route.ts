import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { approveSurvey, OnboardingValidationError } from "@/lib/onboarding/approval/workflow";
import { approveSurveySchema } from "@/lib/validations/onboarding";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = approveSurveySchema.parse(await req.json().catch(() => ({})));

    const result = await approveSurvey({
      surveyId: params.id,
      adminReviewerId: session.user.id,
      adminNotes: body.adminNotes ?? null,
      adminOverrides: body.adminOverrides ?? null,
      createJobsForTypes: body.createJobsForTypes,
      createInitialJobs: body.createInitialJobs,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof OnboardingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
