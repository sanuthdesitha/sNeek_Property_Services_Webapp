import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobStatus, JobType } from "@prisma/client";

function buildWhereClause(params: {
  status: JobStatus | null;
  statusGroup: string | null;
  jobType: JobType | null;
  propertyId: string | null;
  clientId: string | null;
  date: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  role: Role;
  userId: string;
}) {
  const completedStatuses: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];
  const where: Record<string, unknown> = {};

  if (params.status) {
    where.status = params.status;
  } else if (params.statusGroup === "active") {
    where.status = { notIn: completedStatuses };
  } else if (params.statusGroup === "completed") {
    where.status = { in: completedStatuses };
  }

  if (params.jobType) where.jobType = params.jobType;
  if (params.propertyId) where.propertyId = params.propertyId;
  if (params.clientId) where.property = { clientId: params.clientId };

  if (params.date) {
    const d = new Date(params.date);
    // Ignore an unparseable date rather than passing Invalid Date to Prisma (500).
    if (!Number.isNaN(d.getTime())) {
      where.scheduledDate = { gte: d, lt: new Date(d.getTime() + 86400000) };
    }
  } else if (params.dateFrom || params.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (params.dateFrom) {
      const from = new Date(`${params.dateFrom}T00:00:00`);
      if (!Number.isNaN(from.getTime())) dateRange.gte = from;
    }
    if (params.dateTo) {
      const to = new Date(`${params.dateTo}T23:59:59`);
      if (!Number.isNaN(to.getTime())) dateRange.lte = to;
    }
    if (Object.keys(dateRange).length > 0) where.scheduledDate = dateRange;
  }

  if (params.role === Role.CLEANER) {
    where.assignments = { some: { userId: params.userId, removedAt: null } };
    // Skipped cleans are not part of a cleaner's actionable workload.
    where.cleanSkipStatus = { not: "SKIPPED" };
  }

  return where;
}

const JOB_INCLUDE = {
  property: {
    select: {
      name: true,
      suburb: true,
      address: true,
      latitude: true,
      longitude: true,
      client: { select: { id: true, name: true, email: true } },
    },
  },
  assignments: {
    where: { removedAt: null },
    include: { user: { select: { id: true, name: true } } },
  },
  qaReviews: {
    select: { id: true, score: true, passed: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  report: { select: { id: true } },
  issueTickets: {
    where: { caseType: "DAMAGE", status: { not: "RESOLVED" } },
    select: { id: true, status: true, severity: true, title: true },
    take: 5,
  },
  _count: { select: { formSubmissions: true } },
};

// Supported sort modes for the jobs list/board. "soonest" (default) puts the
// nearest scheduled date first; the rest map to explicit Prisma orderBy lists.
type JobSort = "soonest" | "latest" | "created" | "property" | "status";

function buildOrderBy(statusGroup: string | null, sort: JobSort | null) {
  if (sort === "latest") {
    return [
      { scheduledDate: "desc" as const },
      { priorityBucket: "asc" as const },
      { dueTime: "desc" as const },
      { startTime: "desc" as const },
    ];
  }
  if (sort === "created") {
    return [{ createdAt: "desc" as const }];
  }
  if (sort === "property") {
    return [
      { property: { name: "asc" as const } },
      { scheduledDate: "asc" as const },
    ];
  }
  if (sort === "status") {
    return [
      { status: "asc" as const },
      { scheduledDate: "asc" as const },
    ];
  }
  if (sort === "soonest") {
    return [
      { scheduledDate: "asc" as const },
      { priorityBucket: "asc" as const },
      { dueTime: "asc" as const },
      { startTime: "asc" as const },
    ];
  }
  // No explicit sort: fall back to the legacy statusGroup-aware default so older
  // callers keep their previous ordering.
  if (statusGroup === "completed") {
    return [
      { scheduledDate: "desc" as const },
      { priorityBucket: "asc" as const },
      { dueTime: "desc" as const },
      { startTime: "desc" as const },
    ];
  }
  return [
    { scheduledDate: "asc" as const },
    { priorityBucket: "asc" as const },
    { dueTime: "asc" as const },
    { startTime: "asc" as const },
  ];
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") as JobStatus | null;
    const statusGroup = searchParams.get("statusGroup");
    const jobType = searchParams.get("jobType") as JobType | null;
    const propertyId = searchParams.get("propertyId");
    const clientId = searchParams.get("clientId");
    const date = searchParams.get("date");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const rawSort = searchParams.get("sort");
    const sort: JobSort | null =
      rawSort === "soonest" ||
      rawSort === "latest" ||
      rawSort === "created" ||
      rawSort === "property" ||
      rawSort === "status"
        ? rawSort
        : null;

    const page = Math.max(1, Math.floor(Number(searchParams.get("page") ?? "1")));
    const limit = Math.min(5000, Math.max(10, Math.floor(Number(searchParams.get("limit") ?? "50"))));
    const role = session.user.role;
    // Admins/ops get the paginated payload for the unified jobs list. The
    // legacy `statusGroup` param is still honoured for older callers, but is no
    // longer required — the page now filters by explicit `status` + date params.
    const paginated = searchParams.get("paginated");
    const wantsPaginatedPayload =
      role !== Role.CLEANER && (Boolean(statusGroup) || paginated === "1" || paginated === "true");

    const where = buildWhereClause({
      status,
      statusGroup,
      jobType,
      propertyId,
      clientId,
      date,
      dateFrom,
      dateTo,
      role,
      userId: session.user.id,
    });

    const orderBy = buildOrderBy(statusGroup, sort);

    if (wantsPaginatedPayload) {
      const [totalCount, jobs] = await Promise.all([
        db.job.count({ where }),
        db.job.findMany({ where, include: JOB_INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalCount / limit));
      return NextResponse.json({
        jobs,
        pagination: { page, limit, totalCount, totalPages, hasMore: page < totalPages },
      });
    }

    const jobs = await db.job.findMany({ where, include: JOB_INCLUDE, orderBy });
    return NextResponse.json(jobs);
  } catch (err: any) {
    let httpStatus = 500;
    if (err.message === "UNAUTHORIZED") httpStatus = 401;
    else if (err.message === "FORBIDDEN") httpStatus = 403;
    return NextResponse.json({ error: err.message }, { status: httpStatus });
  }
}
