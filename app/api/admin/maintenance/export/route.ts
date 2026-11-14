import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { toCsv } from "@/lib/insights/csv";
import { getAppSettings } from "@/lib/settings";
import { exportAdminMaintenance, parseMaintenanceListFilters } from "@/lib/maintenance/admin-list";
import { MAINTENANCE_LIST_SORTS } from "@/lib/maintenance/admin-list-types";
import { ACTION_LABELS, CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS, STATUS_LABELS } from "@/lib/maintenance/labels";
import { MAINTENANCE_ASSIGNEE_ROLE_LABELS } from "@/lib/maintenance/assignment-roles";

const HEADER = [
  "Item", "Property", "Area", "Category", "Action", "Priority", "Status", "Reported by", "Source", "Reported (local)",
  "Job", "Visit worker", "Others on the item", "Visit (local)", "Estimate (AUD)", "Client price (AUD)", "Client price state",
  "Client sees it", "Needs attention", "Photos",
];

function priceState(value: string | null): string {
  if (value === "PENDING") return "Awaiting client";
  if (value === "APPROVED") return "Approved";
  if (value === "DECLINED") return "Declined";
  return "Not sent";
}

/** GET — CSV of every item matching the list's filters, in the list's order. Missing values stay empty, never 0. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: MAINTENANCE_LIST_SORTS, defaultSort: "priority", defaultDir: "desc", defaultPageSize: 25, maxPageSize: 100 });
    const filters = parseMaintenanceListFilters(params);
    const settings = await getAppSettings();
    const timeZone = settings.timezone || "Australia/Sydney";
    const rows = await exportAdminMaintenance({ filters, sort: query.sort, dir: query.dir, timeZone });
    const local = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd HH:mm") : "");
    const csv = toCsv(HEADER, rows.map((row) => [
      row.title, row.property.name, row.area ?? "", CATEGORY_LABELS[row.category], ACTION_LABELS[row.recommendedAction],
      PRIORITY_LABELS[row.priority], STATUS_LABELS[row.status], row.reportedByName ?? "", SOURCE_LABELS[row.source], local(row.createdAt),
      row.job?.jobNumber ?? "", row.assignedWorker?.name ?? "",
      row.roster.map((person) => `${MAINTENANCE_ASSIGNEE_ROLE_LABELS[person.role]}: ${person.name}`).join("; "),
      local(row.scheduledFor), row.estimatedCost ?? "", row.quotedCost ?? "", priceState(row.costApprovalStatus),
      row.clientVisible ? "Yes" : "No", row.attention?.reason ?? "", row.photoCount,
    ]));
    const stamp = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="maintenance-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : "Export failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Export failed." : message }, { status });
  }
}
