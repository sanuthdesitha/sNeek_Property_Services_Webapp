import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listAssistantTeams } from "@/lib/people/assistants";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/va-teams — People › Assistants: every client assistant team
 * with its client, grants (as enforced), property scope, members (active,
 * invited, invite expired, suspended, team off) and recent activity.
 * ADMIN and OPS_MANAGER (clients pack via the middleware), who could already
 * read the same teams one client at a time from /api/admin/va-invites.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json({ teams: await listAssistantTeams() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load assistant teams." : message }, { status });
  }
}
