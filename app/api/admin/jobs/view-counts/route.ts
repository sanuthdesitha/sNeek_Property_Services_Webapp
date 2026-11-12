import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveRouteRole } from "@/lib/auth/route-role";
import { countSavedViews, savedViewCountsRequestSchema } from "@/lib/jobs/view-saved-counts";

/**
 * POST /api/admin/jobs/view-counts — totals for the person's saved Jobs view
 * tabs in one request. Read-only (POST only because the body carries up to 20
 * list queries). Same roles as the paginated Jobs list, which already shows
 * these administrators and operations managers every job.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const role = resolveRouteRole(session.user, [Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = savedViewCountsRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send up to 20 views, each with an id and its list query." }, { status: 400 });
    const counts = await countSavedViews(parsed.data, { role, userId: session.user.id });
    return NextResponse.json({ counts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not count saved views." : message }, { status });
  }
}
