import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDerivative } from "@/lib/marketing/social/storage";
import { zipFiles } from "@/lib/marketing/social/zip";
import { requireSocialSession, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

export const runtime = "nodejs";

/**
 * The fallback: the cleaned copies already made for this post, as one zip.
 * Only derivatives (never evidence originals). Reads only; the copies are
 * made by POST …/derivatives first.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSocialSession();
    const assets = await db.marketingAsset.findMany({ where: { socialGroupId: params.id, derivativeKind: { not: null } }, orderBy: { createdAt: "asc" } });
    if (assets.length === 0) return NextResponse.json({ error: "Make the cleaned copies first." }, { status: 409 });
    const files = await Promise.all(assets.map(async (asset, index) => ({ name: `sneek-post-${String(index + 1).padStart(2, "0")}.jpg`, bytes: await readDerivative(asset.s3Key ?? "") })));
    const zip = zipFiles(files);
    return new NextResponse(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="sneek-social-post.zip"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
