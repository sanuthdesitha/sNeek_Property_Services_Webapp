import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeAgent, rotateAgentToken } from "@/lib/agents/admin";
import { AGENT_ADMIN_HEADERS, agentAdminFailure, requireAgentAdmin } from "@/lib/agents/admin-http";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rotate"), expiresInDays: z.number(), credentials: z.unknown() }).strict(),
  z.object({ action: z.literal("revoke"), credentials: z.unknown() }).strict(),
]);

/** Rotate (new token shown once, old one revoked) or revoke an agent. ADMIN with own PIN. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: AGENT_ADMIN_HEADERS });
    const session = await requireAgentAdmin({ credentials: parsed.data.credentials ?? {} });
    if (parsed.data.action === "revoke") {
      await revokeAgent(params.id, session.user.id);
      return NextResponse.json({ ok: true }, { headers: AGENT_ADMIN_HEADERS });
    }
    return NextResponse.json(await rotateAgentToken(params.id, { expiresInDays: parsed.data.expiresInDays }, session.user.id), { headers: AGENT_ADMIN_HEADERS });
  } catch (error) { return agentAdminFailure(error); }
}
