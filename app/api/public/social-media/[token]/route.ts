import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyMediaToken } from "@/lib/marketing/social/public-media";
import { readDerivative } from "@/lib/marketing/social/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One cleaned social copy for a network to fetch while it publishes
 * (2026-11-17). The signed, expiring token names the copy and its post; only
 * a stored derivative of that post is served. Never an evidence original,
 * never a list. Any refusal is a plain 404.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const claim = verifyMediaToken(params.token);
  if (!claim) return new NextResponse("Not found", { status: 404 });
  const asset = await db.marketingAsset.findUnique({ where: { id: claim.assetId }, select: { s3Key: true, derivativeKind: true, socialGroupId: true, exifStripped: true } }).catch(() => null);
  if (!asset || !asset.derivativeKind || !asset.exifStripped || asset.socialGroupId !== claim.groupId || !asset.s3Key) return new NextResponse("Not found", { status: 404 });
  try {
    const bytes = await readDerivative(asset.s3Key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=600",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
