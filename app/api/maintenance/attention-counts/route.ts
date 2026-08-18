import { NextResponse } from "next/server";
import { MaintenanceAction, MaintenanceStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * GET /api/maintenance/attention-counts — nav badges for the maintenance portal.
 *
 * Both counts mirror app/v2/maintenance/page.tsx EXACTLY — same OPEN_STATUSES,
 * same replacements predicate — so a badge can never disagree with the number
 * the page itself prints. If that page's definition changes, this must change
 * with it.
 *
 * `/v2/maintenance/tickets`, `/log` and `/more` carry no badge: they have no
 * single unambiguous pending queue, and a guessed number is worse than none.
 *
 * The portal is operation-wide rather than per-worker (the pages list all open
 * items, not just the signed-in worker's), so these are unscoped to match.
 *
 * FAILURE IS SILENT BY DESIGN — each query degrades to 0, the route answers 200.
 */
const OPEN_STATUSES = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.ACKNOWLEDGED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.ORDERED,
];

export async function GET() {
  try {
    await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);

    const [openItems, replacements] = await Promise.all([
      db.propertyMaintenanceItem
        .count({ where: { status: { in: OPEN_STATUSES } } })
        .catch(() => 0),
      db.propertyMaintenanceItem
        .count({
          where: {
            status: { in: OPEN_STATUSES },
            recommendedAction: { in: [MaintenanceAction.REPLACE, MaintenanceAction.RESTOCK] },
          },
        })
        .catch(() => 0),
    ]);

    return NextResponse.json({
      counts: {
        "/v2/maintenance": openItems,
        "/v2/maintenance/replacements": replacements,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load counts." }, { status });
  }
}
