import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DeepCleanPlanningError, listDeepCleanProposals } from "@/lib/properties/deep-clean-planning";
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listDeepCleanProposals(req.nextUrl.searchParams.get("cursor") ?? undefined));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load deep-clean proposals.";
    const status = error instanceof DeepCleanPlanningError ? error.status : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
