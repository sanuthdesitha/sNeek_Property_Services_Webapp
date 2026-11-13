import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { liveErrorStatus, requireLiveViewer } from "@/lib/ops/live-viewer";

export const dynamic = "force-dynamic";

/** At most this many points: the most recent of today's, oldest first. */
const TRAIL_LIMIT = 500;

/**
 * Today's trail (Sydney day) for ONE person, for the Live ops map. Bounded to
 * today and to 500 points; a laundry driver's trail needs the Laundry pack.
 * Every read writes a LOCATION_TRAIL_VIEWED audit row (who looked at whose
 * movements, and how many points), because a trail is more revealing than a
 * single live dot.
 */
export async function GET(req: NextRequest) {
  let viewer;
  try {
    viewer = await requireLiveViewer();
  } catch (err) {
    const status = liveErrorStatus(err);
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }
  const userId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!userId || userId.length > 64) return NextResponse.json({ error: "A person is required." }, { status: 400 });

  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } });
  if (!person || (person.role !== "CLEANER" && person.role !== "LAUNDRY")) {
    return NextResponse.json({ error: "No trail for this person." }, { status: 404 });
  }
  if (person.role === "LAUNDRY" && !viewer.access.drivers) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const todayKey = sydneyTodayKey();
  const rows = await db.cleanerLocationPing.findMany({
    where: { userId, timestamp: { gte: sydneyDayStart(todayKey) } },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: TRAIL_LIMIT,
    select: { lat: true, lng: true, accuracy: true, timestamp: true, source: true, jobId: true },
  });
  const points = rows.reverse().map((row) => ({
    lat: row.lat, lng: row.lng, accuracy: row.accuracy ?? null, measuredAt: row.timestamp.toISOString(), source: row.source, jobId: row.jobId,
  }));

  await db.auditLog.create({
    data: {
      userId: viewer.userId,
      action: "LOCATION_TRAIL_VIEWED",
      entity: "User",
      entityId: userId,
      after: { day: todayKey, points: points.length, truncated: rows.length === TRAIL_LIMIT },
    },
  });

  return NextResponse.json(
    { userId, name: person.name, day: todayKey, truncated: rows.length === TRAIL_LIMIT, points },
    { headers: { "cache-control": "no-store" } },
  );
}
