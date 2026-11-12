import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { answerPurchaseAsk } from "@/lib/inventory/urgent-stock-ask";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** POST { decision: "accept" | "decline", note } — only the asked cleaner, only while asked. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.CLEANER]);
    return urgentJson(await answerPurchaseAsk(session.user, params.id, await req.json()));
  } catch (error) {
    return urgentFailure(error, "Could not record your answer.");
  }
}
