import { resolveRouteRole } from "@/lib/auth/route-role";
import { redactJobForCleaner } from "@/lib/jobs/cleaner-redaction";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
// Server-computed early-checkin / late-checkout badge times (HH:MM), so list
// UIs render timing chips without re-parsing the notes JSON client-side. The
// derivation moved to lib/jobs/timing-badges.ts when the cleaner's own list
// needed the same pills (2026-08).
import { withTimingBadges } from "@/lib/jobs/timing-badges";
import { Role, JobStatus } from "@prisma/client";
import { isListQueryError } from "@/lib/admin/list-query";
import { buildJobsWhere, isJobsFilterError, parseIdList, parseStatusList, readJobsFilterParams } from "@/lib/jobs/list-filters";
import { buildJobsOrderBy, readJobsOrder, readLegacyJobsOrder } from "@/lib/jobs/list-sort";
import { withListExtras } from "@/lib/jobs/list-row-extras";
import { loadJobViewCounts } from "@/lib/jobs/view-counts";
import { JOB_INCLUDE } from "@/lib/jobs/list-include";


export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const { searchParams } = new URL(req.url);
    const filters = readJobsFilterParams(searchParams);

    const page = Math.max(1, Math.floor(Number(searchParams.get("page") ?? "1")));
    const limit = Math.min(5000, Math.max(10, Math.floor(Number(searchParams.get("limit") ?? "50"))));
    const role = resolveRouteRole(session.user, [Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    // Admins/ops get the paginated payload for the unified jobs list. The
    // legacy `statusGroup` param is still honoured for older callers, but is no
    // longer required — the page now filters by explicit `status` + date params.
    const paginated = searchParams.get("paginated");
    const wantsPaginatedPayload =
      role !== Role.CLEANER && (Boolean(filters.statusGroup) || paginated === "1" || paginated === "true");

    if (wantsPaginatedPayload) {
      // The paginated list is strict: an unknown status, selection or sort is
      // refused (400) rather than silently widened to every job or reordered.
      const status = parseStatusList(searchParams.get("status"));
      const ids = parseIdList(searchParams.get("ids"));
      const order = readJobsOrder(searchParams);
      const where = buildJobsWhere({ ...filters, status, ids, role, userId: session.user.id });
      const orderBy = buildJobsOrderBy(order, filters.statusGroup);
      const [totalCount, jobs, counts] = await Promise.all([
        db.job.count({ where }),
        db.job.findMany({ where, include: JOB_INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
        // View-tab totals are requested only by the redesigned Jobs page.
        searchParams.get("counts") === "1" ? loadJobViewCounts() : Promise.resolve(undefined),
      ]);

      const rows = jobs.map(withTimingBadges);
      const totalPages = Math.max(1, Math.ceil(totalCount / limit));
      return NextResponse.json({
        jobs: searchParams.get("extras") === "1" ? await withListExtras(rows) : rows,
        pagination: { page, limit, totalCount, totalPages, hasMore: page < totalPages },
        ...(counts ? { counts } : {}),
      });
    }

    // The legacy array contract is unchanged: one raw status, lenient sort.
    const where = buildJobsWhere({
      ...filters,
      status: searchParams.get("status") as JobStatus | null,
      role,
      userId: session.user.id,
    });
    const orderBy = buildJobsOrderBy(readLegacyJobsOrder(searchParams), filters.statusGroup);
    const jobs = await db.job.findMany({ where, include: JOB_INCLUDE, orderBy });
    return NextResponse.json(jobs
      .filter((job) => role !== Role.CLEANER || !parseJobInternalNotes(job.internalNotes).isDraft)
      .map(withTimingBadges)
      // Timing badges are derived from the notes first; the raw notes, client
      // price and colleagues' pay are then removed for a cleaner.
      .map((job) => (role === Role.CLEANER ? redactJobForCleaner(job, session.user.id) : job)));
  } catch (err: any) {
    if (isListQueryError(err) || isJobsFilterError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    let httpStatus = 500;
    if (err.message === "UNAUTHORIZED") httpStatus = 401;
    else if (err.message === "FORBIDDEN") httpStatus = 403;
    return NextResponse.json({ error: err.message }, { status: httpStatus });
  }
}
