import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { listSuppressed } from "@/lib/email/suppression";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  try {
    await requireRole(["ADMIN", "OPS_MANAGER"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [suppressed, recentLogs, funnel] = await Promise.all([
    listSuppressed(200),
    db.notificationLog
      .findMany({
        where: { channel: "EMAIL" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          recipientEmail: true,
          subject: true,
          status: true,
          createdAt: true,
          eventKey: true,
        },
      })
      .catch(() => []),
    db.notificationLog
      .groupBy({
        by: ["status"],
        where: { channel: "EMAIL", createdAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      })
      .catch(() => [] as any[]),
  ]);

  return NextResponse.json({ suppressed, recentLogs, funnel });
}
