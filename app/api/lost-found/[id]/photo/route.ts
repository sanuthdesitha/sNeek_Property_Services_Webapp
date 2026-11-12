import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { getPresignedDownloadUrl, publicUrl, resolveS3 } from "@/lib/s3";
import { parsePhotos } from "@/lib/lost-found/service";
import { itemHasPhotoKey } from "@/lib/lost-found/photo-src";
import { logger } from "@/lib/logger";

/**
 * GET /api/lost-found/[id]/photo?key=<stored key>
 *
 * Shows one lost and found photo to whoever may open the item, with the same
 * rule as `GET /api/lost-found/[id]`: ADMIN and OPS_MANAGER, or the CLEANER
 * who reported it while the Lost & found module is on. The key must be one of
 * the item's own stored photos (never an arbitrary storage key). Answers with
 * a redirect to a 10-minute signed link, so it works whether the bucket is
 * public or private. When storage cannot sign, it falls back to the public
 * link only if a public base URL is configured; otherwise 503 with the reason,
 * so the screen can say the image could not be loaded.
 */
const SIGNED_SECONDS = 600;

function failure(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
    if (!key || key.length > 1000 || key.includes("..")) return failure(400, "Invalid photo key.", "INVALID_KEY");

    const item = await db.lostFoundItem.findUnique({ where: { id: params.id }, select: { id: true, photos: true, reportedByUserId: true } });
    if (!item) return failure(404, "Item not found.", "NOT_FOUND");

    const role = session.user.role as Role;
    if (role !== Role.ADMIN && role !== Role.OPS_MANAGER) {
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "lostFound") || item.reportedByUserId !== session.user.id) {
        return failure(403, "You cannot open this item.", "FORBIDDEN");
      }
    }
    if (!itemHasPhotoKey(parsePhotos(item.photos), key)) return failure(404, "This photo is not on the item.", "PHOTO_NOT_ON_ITEM");

    let target: string | null = null;
    try {
      const { bucket } = await resolveS3();
      if (!bucket) throw new Error("No storage bucket configured");
      target = await getPresignedDownloadUrl(key, SIGNED_SECONDS);
    } catch (err) {
      logger.warn({ err, itemId: item.id }, "Lost and found photo could not be signed");
      target = process.env.S3_PUBLIC_BASE_URL?.trim() ? publicUrl(key) : null;
    }
    if (!target || !/^https?:\/\//i.test(target)) {
      return failure(503, "File storage is not configured, so the photo cannot be shown.", "STORAGE_UNAVAILABLE");
    }
    const response = NextResponse.redirect(target, 302);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return failure(status, err?.message ?? "Could not load the photo.", status === 400 ? "ERROR" : err.message);
  }
}
