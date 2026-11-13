import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAppUrl } from "@/lib/app-url";
import { createAgent, listAgents, setAgentsPaused } from "@/lib/agents/admin";
import { readableScopesFor } from "@/lib/agents/access";
import { AGENT_ADMIN_HEADERS, agentAdminFailure, requireAgentAdmin } from "@/lib/agents/admin-http";
import { AGENT_MCP_PATH } from "@/lib/agents/scopes";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string(), areas: z.array(z.string()), expiresInDays: z.number(), credentials: z.unknown() }).strict(),
  z.object({ action: z.literal("pause"), paused: z.boolean(), credentials: z.unknown() }).strict(),
]);

/** Agents list for administrators: never a token or its hash, only the prefix. */
export async function GET(request: Request) {
  try {
    const session = await requireAgentAdmin();
    const [list, grantable] = await Promise.all([listAgents(), readableScopesFor(session.user.id)]);
    return NextResponse.json({ ...list, grantable, mcpUrl: resolveAppUrl(AGENT_MCP_PATH, request) }, { headers: AGENT_ADMIN_HEADERS });
  } catch (error) { return agentAdminFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: AGENT_ADMIN_HEADERS });
    const session = await requireAgentAdmin({ credentials: parsed.data.credentials ?? {} });
    if (parsed.data.action === "pause") {
      await setAgentsPaused(parsed.data.paused, session.user.id);
      return NextResponse.json({ ok: true, paused: parsed.data.paused }, { headers: AGENT_ADMIN_HEADERS });
    }
    const { credentials: _credentials, action: _action, ...input } = parsed.data;
    const created = await createAgent(input, session.user.id);
    return NextResponse.json(created, { status: 201, headers: AGENT_ADMIN_HEADERS });
  } catch (error) { return agentAdminFailure(error); }
}
