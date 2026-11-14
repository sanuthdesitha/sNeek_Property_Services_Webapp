import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { getAppSettings } from "@/lib/settings";
import { listAdminMaintenance, parseMaintenanceListFilters } from "@/lib/maintenance/admin-list";
import { MAINTENANCE_LIST_SORTS } from "@/lib/maintenance/admin-list-types";

const MAINTENANCE_LIST_QUERY = {
  sortable: MAINTENANCE_LIST_SORTS,
  defaultSort: "priority" as const,
  defaultDir: "desc" as const,
  defaultPageSize: 25,
  maxPageSize: 100,
};

/**
 * GET — the admin Maintenance list (board "Maintenance"): status bar, filters,
 * server sort and paging → listResponse + { statusCounts, tiles, timeZone }.
 * ADMIN and OPS_MANAGER, as the page; unknown filters or sorts answer 400.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, MAINTENANCE_LIST_QUERY);
    const filters = parseMaintenanceListFilters(params);
    const settings = await getAppSettings();
    return NextResponse.json(await listAdminMaintenance({ filters, query, timeZone: settings.timezone || "Australia/Sydney" }));
  } catch (err) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : "Could not load maintenance items.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load maintenance items." : message }, { status });
  }
}
