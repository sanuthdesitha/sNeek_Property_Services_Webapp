import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { askCandidates, createPurchaseAsk, recordAskOutcomes } from "@/lib/inventory/urgent-stock-ask";
import { sendPurchaseAskNotice } from "@/lib/inventory/urgent-stock-ask-notify";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** GET ?needId= — the next clean's cleaners and every active cleaner. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const needId = req.nextUrl.searchParams.get("needId");
    if (!needId) return urgentJson({ error: "needId is required." }, 400);
    return urgentJson(await askCandidates(session.user, needId));
  } catch (error) {
    return urgentFailure(error, "Could not load cleaners.");
  }
}

/**
 * POST — ask a cleaner to buy (state ASKED), then send the notice with the
 * chosen transports. A retry with the same request key returns the same ask
 * and does not notify twice (the pipeline event id is the ask id).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    const ask = await createPurchaseAsk(session.user, await req.json());
    const outcomes = await sendPurchaseAskNotice(session.user.id, ask);
    await recordAskOutcomes(ask.id, outcomes);
    return urgentJson({ ask, outcomes });
  } catch (error) {
    return urgentFailure(error, "Could not ask the cleaner.");
  }
}
