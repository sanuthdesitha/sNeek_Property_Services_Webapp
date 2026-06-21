import { NextRequest, NextResponse } from "next/server";
import { Role, MaintenanceStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getWorkerForUser } from "@/lib/maintenance/workers";
import { resolvePhotoUrls } from "@/lib/maintenance/access";

const OPEN_STATUSES: MaintenanceStatus[] = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.ACKNOWLEDGED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.ORDERED,
];

// The signed-in maintenance worker's own jobs (scope=active default, or history).
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.MAINTENANCE]);
    const worker = await getWorkerForUser(session.user.id);
    if (!worker) return NextResponse.json({ worker: null, items: [] });

    const scope = new URL(req.url).searchParams.get("scope") ?? "active";
    const items = await db.propertyMaintenanceItem.findMany({
      where: {
        assignedWorkerId: worker.id,
        status: scope === "history" ? { in: [MaintenanceStatus.RESOLVED, MaintenanceStatus.DISMISSED] } : { in: OPEN_STATUSES },
      },
      orderBy: scope === "history" ? [{ resolvedAt: "desc" }] : [{ scheduledFor: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        title: true,
        category: true,
        priority: true,
        status: true,
        area: true,
        scheduledFor: true,
        enRouteAt: true,
        arrivedAt: true,
        clockInAt: true,
        clockOutAt: true,
        outcome: true,
        photoKeys: true,
        property: { select: { name: true, address: true, suburb: true, latitude: true, longitude: true } },
      },
    });

    const withPhotos = await Promise.all(
      items.map(async (it) => ({
        ...it,
        photos: await resolvePhotoUrls(it.photoKeys),
      }))
    );

    return NextResponse.json({
      worker: { id: worker.id, name: worker.name, onboardedAt: worker.onboardedAt },
      items: withPhotos,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
