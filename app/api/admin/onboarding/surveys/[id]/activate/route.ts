import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { activateOnboarding } from "@/lib/onboarding/workspace/activate";
import { activateSchema } from "@/lib/onboarding/workspace/schemas";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

/**
 * Activate: readiness check, then the existing approval service. Same roles as
 * the existing approve route (ADMIN and OPS_MANAGER). Safe to press twice.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = activateSchema.parse(await req.json().catch(() => ({})));
    const result = await activateOnboarding({ surveyId: params.id, actorUserId: session.user.id, createInitialJobs: body.createInitialJobs, baseRevision: body.baseRevision });
    return NextResponse.json(result);
  } catch (error) {
    return onboardingRouteError(error, "activate");
  }
}
