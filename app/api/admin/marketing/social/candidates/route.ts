import { NextRequest, NextResponse } from "next/server";
import { listCandidates } from "@/lib/marketing/social/eligibility";
import { SOCIAL_RATIOS, type SocialRatio } from "@/lib/marketing/social/networks";
import { requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Candidate photos for the social post generator (no AI). ADMIN and
 * OPS_MANAGER with the Marketing pack. Only properties with a recorded
 * marketing permission; jobs without one are counted, never listed.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSocialSession();
    const params = req.nextUrl.searchParams;
    const days = Number(params.get("days") ?? "30");
    const ratio = (SOCIAL_RATIOS as readonly string[]).includes(params.get("ratio") ?? "") ? (params.get("ratio") as SocialRatio) : "4:5";
    if (!Number.isFinite(days) || days < 1 || days > 60) return NextResponse.json({ error: "Choose a period of 1 to 60 days." }, { status: 400 });
    const list = await listCandidates({
      days,
      ratio,
      includeBefore: params.get("includeBefore") === "1",
      hideUsed: params.get("hideUsed") === "1",
      room: params.get("room") || null,
    });
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
