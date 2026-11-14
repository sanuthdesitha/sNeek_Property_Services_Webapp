import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createClientLink } from "@/lib/onboarding/workspace/client-link";
import { clientLinkCreateSchema } from "@/lib/onboarding/workspace/schemas";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

/** Send the client a no-login link to the parts the office ticked. Email or SMS is named explicitly. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "Links cannot be sent while testing as someone else." }, { status: 403 });
    const body = clientLinkCreateSchema.parse(await req.json().catch(() => ({})));
    const result = await createClientLink({ surveyId: params.id, actorUserId: session.user.id, ...body });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return onboardingRouteError(error, "client link create");
  }
}
