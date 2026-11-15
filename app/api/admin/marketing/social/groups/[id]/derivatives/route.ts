import { NextRequest, NextResponse } from "next/server";
import { ensureDerivatives, loadGroupView } from "@/lib/marketing/social/groups";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Makes the cleaned copies for the post (new files in Images, linked to the photos and jobs). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSocialRight("post");
    const images = await ensureDerivatives(params.id, session.user.id);
    return NextResponse.json({ images: images.map((image) => ({ assetId: image.assetId, altText: image.altText, width: image.width, height: image.height })), group: await loadGroupView(params.id) });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
