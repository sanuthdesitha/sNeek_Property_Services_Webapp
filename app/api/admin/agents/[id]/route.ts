import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeAgent, rotateAgentToken, setAgentWriteAreas } from "@/lib/agents/admin";
import { AGENT_ADMIN_HEADERS, agentAdminFailure, requireAgentAdmin } from "@/lib/agents/admin-http";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rotate"), expiresInDays: z.number(), credentials: z.unknown() }).strict(),
  z.object({ action: z.literal("revoke"), credentials: z.unknown() }).strict(),
  z.object({ action: z.literal("write-areas"), writeAreas: z.array(z.string()), credentials: z.unknown() }).strict(),
]);

/** Rotate (new token shown once, old one revoked), revoke, or set the write packs of an agent. ADMIN with own PIN. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: AGENT_ADMIN_HEADERS });
    const session = await requireAgentAdmin({ credentials: parsed.data.credentials ?? {} });
    if (parsed.data.action === "revoke") {
      await revokeAgent(params.id, session.user.id);
      return NextResponse.json({ ok: true }, { headers: AGENT_ADMIN_HEADERS });
    }
    if (parsed.data.action === "write-areas") {
      return NextResponse.json(await setAgentWriteAreas(params.id, { writeAreas: parsed.data.writeAreas }, session.user.id), { headers: AGENT_ADMIN_HEADERS });
    }
    return NextResponse.json(await rotateAgentToken(params.id, { expiresInDays: parsed.data.expiresInDays }, session.user.id), { headers: AGENT_ADMIN_HEADERS });
  } catch (error) { return agentAdminFailure(error); }
}
