import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listAgentRequests } from "@/lib/agents/action-admin";
import { AGENT_REQUEST_HEADERS, agentRequestFailure } from "@/lib/agents/action-http";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/agent-requests — Approvals › Agent requests: waiting requests
 * with the plain-language preview and whether the viewer could decide each,
 * plus the latest decided ones. ADMIN and OPS_MANAGER (Approvals pack, live
 * route guard).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await listAgentRequests({ userId: session.user.id, impersonating: Boolean(session.impersonation) });
    return NextResponse.json(body, { headers: AGENT_REQUEST_HEADERS });
  } catch (error) {
    return agentRequestFailure(error, "The agent requests could not be loaded.");
  }
}
