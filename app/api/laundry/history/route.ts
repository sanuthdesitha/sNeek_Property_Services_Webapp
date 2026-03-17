import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { isLaundryModuleEnabled } from "@/lib/portal-access";

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY]);
    if (session.user.role === Role.LAUNDRY) {
      const settings = await getAppSettings();
      if (!isLaundryModuleEnabled(settings, "history")) {
        return NextResponse.json({ error: "History is not available for laundry users." }, { status: 403 });
      }
    }
    const tasks = await db.laundryTask.findMany({
      include: {
        property: {
          select: {
            name: true,
            suburb: true,
            linenBufferSets: true,
          },
        },
        job: { select: { scheduledDate: true, status: true } },
        confirmations: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
    });
    return NextResponse.json(tasks);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
