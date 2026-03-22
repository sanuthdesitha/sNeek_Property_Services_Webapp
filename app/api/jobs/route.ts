import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobStatus, JobType } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as JobStatus | null;
    const jobType = searchParams.get("jobType") as JobType | null;
    const propertyId = searchParams.get("propertyId");
    const date = searchParams.get("date");
    const role = session.user.role as Role;

    const where: any = {};
    if (status) where.status = status;
    if (jobType) where.jobType = jobType;
    if (propertyId) where.propertyId = propertyId;
    if (date) {
      const d = new Date(date);
      const next = new Date(d.getTime() + 86400_000);
      where.scheduledDate = { gte: d, lt: next };
    }

    // Cleaners only see their own jobs
    if (role === Role.CLEANER) {
      where.assignments = { some: { userId: session.user.id } };
    }

    const jobs = await db.job.findMany({
      where,
      include: {
        property: { select: { name: true, suburb: true, address: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
        qaReviews: {
          select: { id: true, score: true, passed: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { formSubmissions: true } },
      },
      orderBy: [
        { scheduledDate: "asc" },
        { priorityBucket: "asc" },
        { dueTime: "asc" },
        { startTime: "asc" },
      ],
    });

    return NextResponse.json(jobs);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
