import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getServerMapsKey } from "@/lib/maps/server-key";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * A small map image for one pinned point, proxied so the key stays server-side.
 *
 * The access guide needs to SHOW where the bin room is, not offer a link that
 * leaves the app — a cleaner standing in a carpark should not have to bounce to
 * Google Maps and back to see which corner of the building to walk to.
 *
 * Proxied rather than embedded because a Static Maps URL carries the API key in
 * the query string. Building that URL in the browser would publish the key to
 * anyone who opened dev tools, and this key is billable.
 *
 * Returns 404 when no key is configured. That is not an error: the guide's
 * documented fallback is the "Open in Maps" link, which needs no key at all, so
 * an unconfigured install degrades to exactly what it had before.
 */

const MAX_DIMENSION = 640;

export async function GET(req: NextRequest) {
  try {
    // Property locations are not public. This session check is the whole reason
    // this is a route rather than a plain image URL.
    await requireSession();

    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat and lng are required." }, { status: 400 });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "Coordinates out of range." }, { status: 400 });
    }

    // Clamped so a crafted query cannot bill us for a poster-sized render.
    const width = Math.min(MAX_DIMENSION, Math.max(80, Number(searchParams.get("w")) || 320));
    const height = Math.min(MAX_DIMENSION, Math.max(60, Number(searchParams.get("h")) || 160));
    const zoom = Math.min(20, Math.max(1, Number(searchParams.get("zoom")) || 17));

    const key = await getServerMapsKey().catch(() => "");
    if (!key) {
      return NextResponse.json({ error: "Maps is not configured." }, { status: 404 });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
    url.searchParams.set("center", `${lat},${lng}`);
    url.searchParams.set("zoom", String(zoom));
    url.searchParams.set("size", `${width}x${height}`);
    url.searchParams.set("scale", "2");
    url.searchParams.set("markers", `color:0xC8A45C|${lat},${lng}`);
    url.searchParams.set("key", key);

    const upstream = await fetch(url.toString(), { cache: "no-store" });
    if (!upstream.ok) {
      logger.warn({ status: upstream.status }, "Static map fetch failed");
      // Same 404 as "not configured": from the UI's point of view there is no
      // preview to show, and the link fallback is already in place.
      return NextResponse.json({ error: "Map preview unavailable." }, { status: 404 });
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        // A pin does not move. Caching privately keeps it off shared caches
        // (these are property locations) while sparing the billed API a
        // request every time a cleaner reopens the guide.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: "Could not load the map." }, { status });
  }
}
