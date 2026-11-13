import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { decideAgentRequest } from "@/lib/agents/action-execute";
import { AGENT_REQUEST_HEADERS, agentRequestFailure } from "@/lib/agents/action-http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
  credentials: z.object({ pin: z.string().max(20).optional(), password: z.string().max(500).optional(), newPin: z.string().max(20).optional() }).strict().optional(),
}).strict();

/**
 * POST /api/admin/agent-requests/[id] { decision, reason?, credentials? }.
 * Approve runs the existing domain service as the signed-in person after the
 * live checks in lib/agents/action-execute.ts; reject changes nothing. Never
 * while testing as someone; every decision is audited with the actual person.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send approve or reject, an optional reason of up to 500 characters and your PIN where asked." }, { status: 400, headers: AGENT_REQUEST_HEADERS });
    const outcome = await decideAgentRequest({
      requestId: params.id,
      approver: { userId: session.user.id, impersonating: Boolean(session.impersonation) },
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? null,
      credentials: parsed.data.credentials ?? null,
    });
    return NextResponse.json(outcome, { headers: AGENT_REQUEST_HEADERS });
  } catch (error) {
    return agentRequestFailure(error, "The decision could not be recorded.");
  }
}
