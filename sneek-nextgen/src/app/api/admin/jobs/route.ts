import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";
import { createJob, assignJob } from "@/lib/jobs/service";
import type { JobType, JobStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as JobStatus | null;
  const jobType = searchParams.get("jobType") as JobType | null;
  const propertyId = searchParams.get("propertyId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const jobs = await prisma.job.findMany({
    where: {
      ...(status && { status }),
      ...(jobType && { jobType }),
      ...(propertyId && { propertyId }),
      ...(dateFrom && { scheduledDate: { gte: new Date(dateFrom) } }),
      ...(dateTo && { scheduledDate: { lte: new Date(dateTo) } }),
    },
    include: {
      property: { select: { name: true, address: true, suburb: true } },
      assignments: { include: { user: { select: { id: true, name: true } } } },
      laundryTask: { select: { status: true } },
      report: { select: { generatedAt: true } },
    },
    orderBy: [{ scheduledDate: "desc" }, { priorityBucket: "asc" }],
    skip: (page - 1) * limit,
    take: limit,
  });

  const total = await prisma.job.count({
    where: {
      ...(status && { status }),
      ...(jobType && { jobType }),
      ...(propertyId && { propertyId }),
      ...(dateFrom && { scheduledDate: { gte: new Date(dateFrom) } }),
      ...(dateTo && { scheduledDate: { lte: new Date(dateTo) } }),
    },
  });

  return apiSuccess({ jobs, total, page, limit, totalPages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const body = await req.json();

  if (!body.propertyId || !body.jobType || !body.scheduledDate) {
    return apiError("propertyId, jobType, and scheduledDate are required", 400);
  }

  const job = await createJob({
    propertyId: body.propertyId,
    jobType: body.jobType,
    scheduledDate: new Date(body.scheduledDate),
    startTime: body.startTime,
    endTime: body.endTime,
    dueTime: body.dueTime,
    estimatedHours: body.estimatedHours,
    notes: body.notes,
    internalNotes: body.internalNotes,
    priorityBucket: body.priorityBucket,
    priorityReason: body.priorityReason,
    sameDayCheckin: body.sameDayCheckin,
    sameDayCheckinTime: body.sameDayCheckinTime,
    requiresSafetyCheckin: body.requiresSafetyCheckin,
    reservationId: body.reservationId,
  });

  // Assign cleaner if provided
  if (body.assignedTo) {
    await assignJob(job.id, body.assignedTo, true, body.assignedById);
  }

  return apiSuccess(job);
}
