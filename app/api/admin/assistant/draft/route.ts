import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/rbac/can";
import { draftClientReply, draftQuoteNotes } from "@/lib/assistant/explain-and-draft";
import { ASSISTANT_HEADERS, assistantFailure, canReadArea, requireAssistantUser } from "@/lib/assistant/http";

export const dynamic = "force-dynamic";
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client_reply"), clientId: z.string().min(1).max(100), intent: z.string().max(500).optional() }).strict(),
  z.object({ kind: z.literal("quote_notes"), quoteId: z.string().min(1).max(100) }).strict(),
]);

/**
 * A draft for an editor (client reply, quote office notes). Never sends and
 * never saves: the person edits it and uses the existing send or save.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAssistantUser();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid draft request." }, { status: 400, headers: ASSISTANT_HEADERS });
    const actor = { kind: "user" as const, userId: session.user.id };
    if (parsed.data.kind === "client_reply") {
      if (!(await can(session, "messages.read"))) return NextResponse.json({ error: "Your access does not include client messages." }, { status: 403, headers: ASSISTANT_HEADERS });
      return NextResponse.json(await draftClientReply({ clientId: parsed.data.clientId, intent: parsed.data.intent ?? null, actor }), { headers: ASSISTANT_HEADERS });
    }
    if (!(await canReadArea(session, "quotes"))) return NextResponse.json({ error: "Your access does not include quotes." }, { status: 403, headers: ASSISTANT_HEADERS });
    return NextResponse.json(await draftQuoteNotes({ quoteId: parsed.data.quoteId, actor }), { headers: ASSISTANT_HEADERS });
  } catch (error) { return assistantFailure(error, "No draft could be made right now. Write it yourself or try again."); }
}
