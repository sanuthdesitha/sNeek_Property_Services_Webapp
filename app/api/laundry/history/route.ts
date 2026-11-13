import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { isLaundryModuleEnabled } from "@/lib/portal-access";
import { isLaundryOfficeRole, propertyIsVisibleToLaundry } from "@/lib/laundry/teams";

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY]);
    if (!isLaundryOfficeRole(session.user.role)) {
      const settings = await getAppSettings();
      if (!isLaundryModuleEnabled(settings, "history")) {
        return NextResponse.json({ error: "History is not available for laundry users." }, { status: 403 });
      }
    }
    const tasks = await db.laundryTask.findMany({
      // Voided runs are gone from the laundry history (2026-11-14).
      where: { voidedAt: null },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
            linenBufferSets: true,
            accessInfo: true,
            laundryEnabled: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            pricePerKg: true,
            avgTurnaround: true,
          },
        },
        job: { select: { scheduledDate: true, status: true } },
        confirmations: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
    });
    const visibleTasks =
      !isLaundryOfficeRole(session.user.role)
        ? tasks.filter((task) => propertyIsVisibleToLaundry(task.property, session.user.id))
        : tasks;
    return NextResponse.json(visibleTasks);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
