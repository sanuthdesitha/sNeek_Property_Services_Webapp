import { NextRequest, NextResponse } from "next/server";
import { suggestCaptions } from "@/lib/marketing/social/ai-captions";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Optional AI caption help (feature social_post). Refused while testing as
 * someone (the request runs as the person). "AI off" answers 200 with
 * state "unavailable" and its reason; nothing is saved.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    if (session.impersonation) return NextResponse.json({ state: "unavailable", message: "AI caption help is not available while testing as someone." });
    return NextResponse.json(await suggestCaptions({ groupId: params.id, actorId: session.user.id }));
  } catch (error) {
    return socialErrorResponse(error);
  }
}
