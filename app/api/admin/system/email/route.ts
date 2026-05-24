import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { listSuppressed } from "@/lib/email/suppression";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "OPS_MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
