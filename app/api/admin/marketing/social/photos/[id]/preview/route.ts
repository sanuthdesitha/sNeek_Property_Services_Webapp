import { NextRequest, NextResponse } from "next/server";
import { checkPhotos } from "@/lib/marketing/social/eligibility";
import { makeSocialPreview } from "@/lib/marketing/social/image-pipeline";
import { SOCIAL_RATIOS, type SocialRatio } from "@/lib/marketing/social/networks";
import { readEvidencePhoto } from "@/lib/marketing/social/storage";
import { requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const runtime = "nodejs";

/**
 * A cleaned preview of one candidate photo (stamp band cut off, metadata
 * removed), made on the fly and not stored. Eligible photos only.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSocialSession();
    const ratio = (SOCIAL_RATIOS as readonly string[]).includes(req.nextUrl.searchParams.get("ratio") ?? "") ? (req.nextUrl.searchParams.get("ratio") as SocialRatio) : "4:5";
    const { eligible, refused } = await checkPhotos([params.id], { ratio, allowLeftOut: true });
    const photo = eligible.get(params.id);
    if (!photo) return NextResponse.json({ error: refused[0]?.reason ?? "This photo cannot be used." }, { status: 404 });
    const copy = await makeSocialPreview(await readEvidencePhoto(photo.s3Key), ratio);
    return new NextResponse(new Uint8Array(copy), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
