import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const pingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  heading: z.number().optional(),
  speed: z.number().optional(),
  timestamp: z.string().datetime().optional(),
});

// Per-user rate limit — client throttles to ~20s; this stops a buggy client
// from flooding the ping table.
const RATE_LIMIT_MS = 10_000;
const STALE_PING_MS = 5 * 60_000;

const globalRef = globalThis as unknown as { __sneekLaundryPingRateLimit?: Map<string, number> };
if (!globalRef.__sneekLaundryPingRateLimit) globalRef.__sneekLaundryPingRateLimit = new Map();
const lastPingByUser = globalRef.__sneekLaundryPingRateLimit;

/**
 * Live location ping for the laundry driver while a route is active.
 *
 * Storage reuses the existing CleanerLocationPing table (keyed by userId —
 * laundry users have user ids too; no schema change). The table's required
 * jobId FK is satisfied by anchoring the ping to the job behind the driver's
 * most relevant laundry task (today's first, falling back to the most recent).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = pingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const ping = parsed.data;
    const pingAt = ping.timestamp ? new Date(ping.timestamp) : now;
    if (nowMs - pingAt.getTime() > STALE_PING_MS) {
      return NextResponse.json({ ok: true, received: 0, dropped: 1 });
    }

    // Anchor jobId: prefer a laundry task active today, else the latest one.
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const anchorTask =
      (await db.laundryTask.findFirst({
        where: {
          OR: [
            { pickupDate: { gte: dayStart, lt: dayEnd } },
            { dropoffDate: { gte: dayStart, lt: dayEnd } },
          ],
        },
        orderBy: { pickupDate: "asc" },
        select: { jobId: true },
      })) ??
      (await db.laundryTask.findFirst({
        orderBy: { createdAt: "desc" },
        select: { jobId: true },
      }));

    if (!anchorTask) {
      // Nothing to anchor against — no laundry tasks exist yet. Don't error
      // the client loop; just acknowledge without storing.
      return NextResponse.json({ ok: true, received: 0, dropped: 1, reason: "NO_LAUNDRY_TASKS" });
    }

    await db.cleanerLocationPing.create({
      data: {
        jobId: anchorTask.jobId,
        userId,
        lat: ping.lat,
        lng: ping.lng,
        accuracy: ping.accuracy,
        heading: ping.heading,
        speed: ping.speed,
        timestamp: pingAt,
      },
    });

    await db.user.update({ where: { id: userId }, data: { lastSeenAt: now } });

    return NextResponse.json({ ok: true, received: 1 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
