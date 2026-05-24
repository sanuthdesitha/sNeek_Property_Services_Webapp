import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SNAPSHOT_WINDOW_MS = 15 * 60_000;

/**
 * Snapshot of the latest ping per active cleaner over the last 15 minutes.
 * The live map page calls this once on mount; subsequent updates arrive via
 * the SSE stream at /api/admin/ops/live-locations/stream.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN && session?.user?.role !== Role.OPS_MANAGER) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const since = new Date(Date.now() - SNAPSHOT_WINDOW_MS);
  const pings = await db.cleanerLocationPing.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    distinct: ["userId"],
    include: {
      user: { select: { id: true, name: true, lastSeenAt: true } },
    },
  });

  return NextResponse.json({ pings });
}
