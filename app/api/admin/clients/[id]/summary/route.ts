import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadClientSummary } from "@/lib/people/clients/summary";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * GET /api/admin/clients/[id]/summary — the People side panel for one client:
 * contact, terms, owing per invoice, 12-month margin, properties, portal
 * logins and assistant teams, and what needs attention. ADMIN and OPS_MANAGER
 * (clients pack via the middleware), who saw the same figures on the client
 * page before the redesign.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const summary = await loadClientSummary(params.id, { money: true, profit: true });
    if (!summary) return NextResponse.json({ error: "Client not found." }, { status: 404, headers });
    return NextResponse.json(summary, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401, headers });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403, headers });
    return NextResponse.json({ error: "Could not load the client." }, { status: 500, headers });
  }
}
