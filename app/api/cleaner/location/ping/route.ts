import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";
import { checkGeofenceForPing } from "@/lib/gps/geofence";

const pingSchema = z.object({
  jobId: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
  heading: z.number().optional(),
  speed: z.number().optional(),
  timestamp: z.string().datetime().optional(),
});

const bodySchema = z.union([
  pingSchema, // single ping
  z.array(pingSchema).max(50), // batch
]);

export const dynamic = "force-dynamic";

// Per-user rate limit — at most one ping batch every RATE_LIMIT_MS.
// Client GPS interval is 30s; this gives lots of headroom but stops a
// buggy / malicious client from flooding the endpoint.
const RATE_LIMIT_MS = 10_000;
const STALE_PING_MS = 5 * 60_000;

const globalRef = globalThis as unknown as { __sneekPingRateLimit?: Map<string, number> };
if (!globalRef.__sneekPingRateLimit) globalRef.__sneekPingRateLimit = new Map();
const lastPingByUser = globalRef.__sneekPingRateLimit;

// Opportunistic cleanup so the map can't grow unbounded.
function pruneRateLimitMap(now: number) {
  if (lastPingByUser.size < 1000) return;
  lastPingByUser.forEach((t, k) => {
    if (now - t > 60_000) lastPingByUser.delete(k);
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();
  const nowMs = now.getTime();

  const last = lastPingByUser.get(userId);
  if (last && nowMs - last < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: "Rate limited", retryAfterMs: RATE_LIMIT_MS - (nowMs - last) },
      { status: 429 },
    );
  }
  lastPingByUser.set(userId, nowMs);
  pruneRateLimitMap(nowMs);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const rawPings = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  // Drop any ping older than STALE_PING_MS — prevents a queue-flush from
  // a previously-offline client from spamming us with ancient data.
  const pings = rawPings.filter((p) => {
    if (!p.timestamp) return true;
    return nowMs - new Date(p.timestamp).getTime() < STALE_PING_MS;
  });

  if (pings.length === 0) {
    return NextResponse.json({ ok: true, received: 0, dropped: rawPings.length });
  }

  // Persist all pings
  await db.cleanerLocationPing.createMany({
    data: pings.map((p) => ({
      jobId: p.jobId,
      userId,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      heading: p.heading,
      speed: p.speed,
      timestamp: p.timestamp ? new Date(p.timestamp) : now,
    })),
  });

  // Denormalize User.lastSeenAt so the live-locations endpoint can sort by it
  // without scanning the ping table.
  await db.user.update({
    where: { id: userId },
    data: { lastSeenAt: now },
  });

  // Check geofence on the LATEST ping only — cheaper, sufficient for
  // arrival/departure detection at the cleaner's currently-active job.
  const latest = pings[pings.length - 1];
  const geofenceResult = await checkGeofenceForPing({
    userId,
    lat: latest.lat,
    lng: latest.lng,
    pingAt: latest.timestamp ? new Date(latest.timestamp) : now,
  });

  return NextResponse.json({
    ok: true,
    received: pings.length,
    dropped: rawPings.length - pings.length,
    geofence: geofenceResult,
  });
}
