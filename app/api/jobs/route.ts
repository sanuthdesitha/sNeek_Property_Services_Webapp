import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobStatus, JobType } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as JobStatus | null;
    const statusGroup = searchParams.get("statusGroup");
    const jobType = searchParams.get("jobType") as JobType | null;
    const propertyId = searchParams.get("propertyId");
    const date = searchParams.get("date");
    const pageParam = Number(searchParams.get("page") ?? "1");
    const limitParam = Number(searchParams.get("limit") ?? "50");
    const role = session.user.role as Role;
    const wantsPaginatedPayload = role !== Role.CLEANER && Boolean(statusGroup);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(10, Math.floor(limitParam))) : 50;
    const completedStatuses: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];

    const where: any = {};
    if (status) where.status = status;
    if (!status && statusGroup === "active") {
      where.status = { notIn: completedStatuses };
    }
    if (!status && statusGroup === "completed") {
      where.status = { in: completedStatuses };
    }
    if (jobType) where.jobType = jobType;
    if (propertyId) where.propertyId = propertyId;
    if (date) {
      const d = new Date(date);
      const next = new Date(d.getTime() + 86400_000);
      where.scheduledDate = { gte: d, lt: next };
    }

    // Cleaners only see their own jobs
    if (role === Role.CLEANER) {
      where.assignments = { some: { userId: session.user.id, removedAt: null } };
    }

    const include = {
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

    const orderBy =
      statusGroup === "completed"
        ? [
            { scheduledDate: "desc" as const },
            { updatedAt: "desc" as const },
            { dueTime: "desc" as const },
            { startTime: "desc" as const },
          ]
        : [
            { scheduledDate: "asc" as const },
            { priorityBucket: "asc" as const },
            { dueTime: "asc" as const },
            { startTime: "asc" as const },
          ];

    if (wantsPaginatedPayload) {
      const [totalCount, jobs] = await Promise.all([
        db.job.count({ where }),
        db.job.findMany({
          where,
          include,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalCount / limit));
      return NextResponse.json({
        jobs,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
        },
      });
    }

    const jobs = await db.job.findMany({
      where,
      include,
      orderBy,
    });

    return NextResponse.json(jobs);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
