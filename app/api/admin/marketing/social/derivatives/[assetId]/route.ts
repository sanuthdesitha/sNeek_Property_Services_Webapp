import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDerivative } from "@/lib/marketing/social/storage";
import { requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const runtime = "nodejs";

/** A stored cleaned copy, for the office (the Images library and the generator). */
export async function GET(_req: NextRequest, { params }: { params: { assetId: string } }) {
  try {
    await requireSocialSession();
    const asset = await db.marketingAsset.findUnique({ where: { id: params.assetId }, select: { s3Key: true, derivativeKind: true } });
    if (!asset?.derivativeKind || !asset.s3Key) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const bytes = await readDerivative(asset.s3Key);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
