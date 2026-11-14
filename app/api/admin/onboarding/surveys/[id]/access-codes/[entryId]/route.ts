import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { revealAccessCode, reviewClientCode } from "@/lib/onboarding/workspace/service";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

const bodySchema = z.object({ action: z.enum(["review", "reveal"]) });

/** "review" accepts a code the client typed; "reveal" shows a stored code to the office (audited). */
export async function POST(req: NextRequest, { params }: { params: { id: string; entryId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    if (body.action === "review") return NextResponse.json(await reviewClientCode({ surveyId: params.id, entryId: params.entryId, actorUserId: session.user.id }));
    const code = await revealAccessCode({ surveyId: params.id, entryId: params.entryId, actorUserId: session.user.id });
    return NextResponse.json({ code }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return onboardingRouteError(error, "access code");
  }
}
