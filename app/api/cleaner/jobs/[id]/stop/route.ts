import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const openLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id, stoppedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (!openLog)
      return NextResponse.json({ error: "No active time log" }, { status: 400 });

    const now = new Date();
    const durationM = Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000);

    await db.timeLog.update({
      where: { id: openLog.id },
      data: { stoppedAt: now, durationM },
    });

    return NextResponse.json({ ok: true, durationM });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
