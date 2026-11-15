import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { publicUrl, s3 } from "@/lib/s3";
import { getClientIp, rateLimit } from "@/lib/security/rate-limit";
import { CLIENT_LINK_REFUSALS, clientLinkRateLimited, clientPhotoPrefix, resolveClientLink } from "@/lib/onboarding/workspace/client-link";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif" };

/** A photo from the client's link: images only, kept as uploaded, filed under this link. */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const ip = getClientIp(req);
    if (clientLinkRateLimited(params.token, ip) || !rateLimit(`onb-link-photo:${params.token.slice(0, 12)}`, { limit: 40, windowMs: 60 * 60_000 }).ok) {
      return NextResponse.json({ error: "Too many photos at once. Wait a little and try again." }, { status: 429 });
    }
    const resolved = await resolveClientLink(params.token);
    if (resolved.state !== "open") return NextResponse.json({ error: CLIENT_LINK_REFUSALS[resolved.state] }, { status: resolved.state === "invalid" ? 404 : 410 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a photo." }, { status: 400 });
    const extension = TYPES[file.type.toLowerCase()];
    if (!extension) return NextResponse.json({ error: "Only photos (JPG, PNG, WEBP or HEIC) can be added." }, { status: 400 });
    if (!file.size || file.size > MAX_BYTES) return NextResponse.json({ error: "The photo must be under 12 MB." }, { status: 400 });
    const key = `${clientPhotoPrefix(resolved.survey.id, resolved.link.id)}${randomUUID()}${extension}`;
    await s3.putObject({ Bucket: process.env.S3_BUCKET_NAME!, Key: key, Body: Buffer.from(await file.arrayBuffer()), ContentType: file.type }).promise();
    return NextResponse.json({ key, url: publicUrl(key) }, { status: 201 });
  } catch (error) {
    return onboardingRouteError(error, "client link photo");
  }
}
