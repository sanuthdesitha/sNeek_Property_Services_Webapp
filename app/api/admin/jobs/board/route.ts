import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveRouteRole } from "@/lib/auth/route-role";
import { db } from "@/lib/db";
import { isListQueryError } from "@/lib/admin/list-query";
import { JOBS_BOARD_LANES, JOBS_BOARD_LANE_LIMIT } from "@/lib/jobs/board-lanes";
import { buildJobsWhere, isJobsFilterError, parseStatusList, readJobsFilterParams } from "@/lib/jobs/list-filters";
import { withListExtras } from "@/lib/jobs/list-row-extras";
import { readJobsListOrder } from "@/lib/jobs/list-sort";
import { findJobsPage, isJobsSortTooLargeError } from "@/lib/jobs/list-computed-sort";
import { withTimingBadges } from "@/lib/jobs/timing-badges";

/**
 * GET /api/admin/jobs/board — the Jobs board for the current filters.
 *
 * Lane counts are real totals from one grouped query over the same `where`
 * the list uses (not the 50 rows of the list's current page); each lane then
 * carries its first rows in the list's sort order. Same roles and filters as
 * the paginated list.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const role = resolveRouteRole(session.user, [Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const filters = readJobsFilterParams(searchParams);
    const status = parseStatusList(searchParams.get("status"));
    const order = readJobsListOrder(searchParams);
    const where = buildJobsWhere({ ...filters, status, role, userId: session.user.id });

    const grouped = await db.job.groupBy({ by: ["status"], where, _count: { _all: true } });
    const countByStatus = new Map(grouped.map((row) => [String(row.status), row._count._all]));

    const lanes = await Promise.all(
      JOBS_BOARD_LANES.map(async (lane) => {
        const count = lane.statuses.reduce((sum, value) => sum + (countByStatus.get(value) ?? 0), 0);
        // Same order as the list, computed sorts included (whole lane, then cut).
        const jobs = count === 0 ? [] : await findJobsPage({
          where: { AND: [where, { status: { in: lane.statuses } }] },
          order,
          statusGroup: filters.statusGroup,
          skip: 0,
          take: JOBS_BOARD_LANE_LIMIT,
          totalCount: count,
        });
        return { id: lane.id, label: lane.label, statuses: lane.statuses, count, jobs: await withListExtras(jobs.map(withTimingBadges)) };
      }),
    );
    const total = Array.from(countByStatus.values()).reduce((sum, value) => sum + value, 0);
    return NextResponse.json({ lanes, total, laneLimit: JOBS_BOARD_LANE_LIMIT }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    if (isJobsSortTooLargeError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (isListQueryError(err) || isJobsFilterError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the board." : message }, { status });
  }
}
