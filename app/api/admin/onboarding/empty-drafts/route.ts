import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { emptyDraftWhere, listEmptyDrafts, overridesHoldAnswers } from "@/lib/onboarding/workspace/service";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

/**
 * One-off review of drafts with no answers (left by the old open-to-create
 * page). ADMIN only. Nothing is deleted automatically: the administrator picks
 * the drafts, and each one is checked again for answers in the same request.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json({ drafts: await listEmptyDrafts() });
  } catch (error) {
    return onboardingRouteError(error, "empty drafts list");
  }
}

const deleteSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "Not while testing as someone else." }, { status: 403 });
    const { ids } = deleteSchema.parse(await req.json().catch(() => ({})));
    const results = await db.$transaction(async (tx) => {
      const candidates = await tx.propertyOnboardingSurvey.findMany({ where: { ...emptyDraftWhere(), id: { in: ids } }, select: { id: true, surveyNumber: true, adminOverrides: true } });
      const deletable = candidates.filter((candidate) => !overridesHoldAnswers(candidate.adminOverrides));
      if (deletable.length) await tx.propertyOnboardingSurvey.deleteMany({ where: { id: { in: deletable.map((candidate) => candidate.id) } } });
      await tx.auditLog.create({ data: { userId: session.user.id, action: "ONBOARDING_EMPTY_DRAFTS_DELETED", entity: "PropertyOnboardingSurvey", entityId: "empty-drafts-review", after: { deleted: deletable.map((candidate) => candidate.surveyNumber), requested: ids.length } } });
      const deletedIds = new Set(deletable.map((candidate) => candidate.id));
      return ids.map((id) => ({ id, outcome: deletedIds.has(id) ? "deleted" : "kept_has_answers_or_gone" }));
    });
    return NextResponse.json({ results });
  } catch (error) {
    return onboardingRouteError(error, "empty drafts delete");
  }
}
