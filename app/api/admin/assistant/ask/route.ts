import { NextResponse } from "next/server";
import { z } from "zod";
import { askOperations } from "@/lib/assistant/ask";
import { ASSISTANT_HEADERS, assistantFailure, requireAssistantUser } from "@/lib/assistant/http";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ question: z.string().trim().min(3).max(500) }).strict();

/** Ask on Command: answered only from data the signed-in person can read. Read-only. */
export async function POST(request: Request) {
  try {
    const session = await requireAssistantUser();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Ask a question of 3 to 500 characters." }, { status: 400, headers: ASSISTANT_HEADERS });
    return NextResponse.json(await askOperations({ question: parsed.data.question, user: { id: session.user.id, name: session.user.name } }), { headers: ASSISTANT_HEADERS });
  } catch (error) { return assistantFailure(error, "Ask could not answer right now. Try again, or look it up on the page."); }
}
