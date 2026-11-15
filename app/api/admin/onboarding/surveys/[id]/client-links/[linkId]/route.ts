import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { revokeClientLink } from "@/lib/onboarding/workspace/client-link";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

/** Revoke a client link: it stops working at once. Answers already saved stay. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; linkId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await revokeClientLink({ surveyId: params.id, linkId: params.linkId, actorUserId: session.user.id }));
  } catch (error) {
    return onboardingRouteError(error, "client link revoke");
  }
}
