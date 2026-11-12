import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { withdrawPurchaseAsk } from "@/lib/inventory/urgent-stock-ask";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

const withdrawInput = z.object({ action: z.literal("withdraw"), reason: z.string().trim().min(1, "Give a reason.").max(1000) }).strict();

/** POST — withdraw an ask the cleaner has not answered yet. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    const input = withdrawInput.parse(await req.json());
    return urgentJson(await withdrawPurchaseAsk(session.user, params.id, input.reason));
  } catch (error) {
    return urgentFailure(error, "Could not withdraw the ask.");
  }
}
