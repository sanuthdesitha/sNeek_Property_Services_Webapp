import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/security/rate-limit";
import { getPresignedDownloadUrl, publicUrl, resolveS3 } from "@/lib/s3";
import { logger } from "@/lib/logger";
import { resolveGuestLink } from "@/lib/lost-found/guest-link";
import { parsePhotos } from "@/lib/lost-found/service";

/**
 * GET /api/public/lost-found/[token]/photo?n=<index>
 *
 * One photo of the item behind the guest's token (the first by default), for
 * the guest's page and the email they get. The photo is chosen by its position
 * on that item only; no storage key is accepted or revealed. Answers with a
 * redirect to a 10-minute signed link (the same as the office's photo route);
 * a refused or expired link, or a missing photo, answers 404 with no detail.
 */
export const dynamic = "force-dynamic";

const SIGNED_SECONDS = 600;

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!rateLimit(`lf-photo:${params.token.slice(0, 12)}:${getClientIp(req)}`, { limit: 120, windowMs: 60_000 }).ok) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    const resolved = await resolveGuestLink(params.token);
    if (resolved.state !== "open") return notFound();
    const index = Number(req.nextUrl.searchParams.get("n") ?? "0");
    const photos = parsePhotos(resolved.item.photos);
    if (!Number.isInteger(index) || index < 0 || index >= photos.length) return notFound();
    const key = photos[index].key;
    let target: string | null = null;
    try {
      const { bucket } = await resolveS3();
      if (!bucket) throw new Error("No storage bucket configured");
      target = await getPresignedDownloadUrl(key, SIGNED_SECONDS);
    } catch (err) {
      logger.warn({ err, itemId: resolved.item.id }, "Lost and found guest photo could not be signed");
      target = process.env.S3_PUBLIC_BASE_URL?.trim() ? publicUrl(key) : null;
    }
    if (!target || !/^https?:\/\//i.test(target)) {
      return NextResponse.json({ error: "The photo cannot be shown right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const response = NextResponse.redirect(target, 302);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (err) {
    logger.error({ err }, "lost and found guest photo failed");
    return notFound();
  }
}
