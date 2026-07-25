import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { addDays } from "date-fns";
import { getApiErrorStatus } from "@/lib/api/http";
import { fetchLaundryWeekTasks } from "@/lib/laundry/week-feed";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY]);
    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get("start");
    const daysParam = Number(searchParams.get("days") ?? 7);
    const rangeDays = Number.isFinite(daysParam)
      ? Math.min(366, Math.max(1, Math.round(daysParam)))
      : 7;
    const weekStart = startParam ? new Date(startParam) : new Date();
    const weekEnd = addDays(weekStart, rangeDays);

    // Query + include + team scoping live in lib/laundry/week-feed.ts (shared
    // with the route-builder API and the plan brief).
    const visibleTasks = await fetchLaundryWeekTasks(weekStart, weekEnd, {
      role: session.user.role,
      userId: session.user.id,
    });

    return NextResponse.json(visibleTasks);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
