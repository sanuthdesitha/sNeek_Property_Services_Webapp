import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { addDays } from "date-fns";
import { getApiErrorStatus } from "@/lib/api/http";
import { propertyIsVisibleToLaundry } from "@/lib/laundry/teams";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY]);
    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get("start");
    const daysParam = Number(searchParams.get("days") ?? 7);
    const rangeDays = Number.isFinite(daysParam)
      ? Math.min(62, Math.max(1, Math.round(daysParam)))
      : 7;
    const weekStart = startParam ? new Date(startParam) : new Date();
    const weekEnd = addDays(weekStart, rangeDays);

    const tasks = await db.laundryTask.findMany({
      where: {
        OR: [
          { pickupDate: { gte: weekStart, lt: weekEnd } },
          { dropoffDate: { gte: weekStart, lt: weekEnd } },
        ],
      },
      include: {
        property: {
          select: {
            name: true,
            suburb: true,
            linenBufferSets: true,
            accessInfo: true,
          },
        },
        job: { select: { scheduledDate: true, status: true } },
        confirmations: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { pickupDate: "asc" },
    });

    const visibleTasks =
      session.user.role === Role.LAUNDRY
        ? tasks.filter((task) => propertyIsVisibleToLaundry(task.property?.accessInfo, session.user.id))
        : tasks;

    return NextResponse.json(visibleTasks);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
