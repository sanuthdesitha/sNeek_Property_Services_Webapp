import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadWorkspaceView, saveWorkspaceSection } from "@/lib/onboarding/workspace/service";
import { workspaceSaveSchema } from "@/lib/onboarding/workspace/schemas";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

/** The onboarding workspace: every step's values, readiness, client links and history. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const view = await loadWorkspaceView(params.id, session.user.role);
    if (!view) return NextResponse.json({ error: "This onboarding no longer exists." }, { status: 404 });
    return NextResponse.json(view);
  } catch (error) {
    return onboardingRouteError(error, "workspace read");
  }
}

/** Save one step's changed fields (per-field autosave). A stale save is kept and reports the other change. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = workspaceSaveSchema.parse(await req.json().catch(() => ({})));
    const result = await saveWorkspaceSection({
      surveyId: params.id,
      section: body.section,
      values: body.values,
      baseRevision: body.baseRevision,
      skipped: body.skipped,
      actor: { source: "ADMIN_CREATED", userId: session.user.id, clientLinkId: null },
    });
    return NextResponse.json(result);
  } catch (error) {
    return onboardingRouteError(error, "workspace save");
  }
}
