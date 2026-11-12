import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { extendedEnforcementFor } from "@/lib/forms/validation-enforcement-server";

/**
 * GET /api/cleaner/jobs/[id]/form-validation — whether the phone should show
 * the extended answer checks inline for THIS cleaner on THIS job. Same
 * decision as the submit route (settings.formValidation + the cleaner's first
 * clock-in on the job), so the phone never blocks what the server would
 * accept, and never hides what it would reject. Assigned cleaner only.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const assignment = await db.jobAssignment.findFirst({ where: { jobId: params.id, userId: session.user.id, removedAt: null }, select: { id: true } });
    if (!assignment) return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    const settings = await getAppSettings();
    const decision = await extendedEnforcementFor(db, { jobId: params.id, userId: session.user.id, settings: settings.formValidation });
    return NextResponse.json({ enforceExtended: decision.enforce }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
