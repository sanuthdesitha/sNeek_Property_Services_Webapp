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
    where.scheduledDate = { gte: d, lt: new Date(d.getTime() + 86400000) };
  } else if (params.dateFrom || params.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (params.dateFrom) dateRange.gte = new Date(`${params.dateFrom}T00:00:00`);
    if (params.dateTo) dateRange.lte = new Date(`${params.dateTo}T23:59:59`);
    where.scheduledDate = dateRange;
  }

  if (params.role === Role.CLEANER) {
    where.assignments = { some: { userId: params.userId, removedAt: null } };
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

function buildOrderBy(statusGroup: string | null) {
  const direction = statusGroup === "completed" ? "desc" : "asc";
  return [
    { scheduledDate: direction as const },
    { priorityBucket: "asc" as const },
    { dueTime: direction as const },
    { startTime: direction as const },
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

    const page = Math.max(1, Math.floor(Number(searchParams.get("page") ?? "1")));
    const limit = Math.min(100, Math.max(10, Math.floor(Number(searchParams.get("limit") ?? "50"))));
    const role = session.user.role;
    const wantsPaginatedPayload = role !== Role.CLEANER && Boolean(statusGroup);

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

    const orderBy = buildOrderBy(statusGroup);

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
