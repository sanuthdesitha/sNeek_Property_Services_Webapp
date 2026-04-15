import { prisma } from "@/lib/db/prisma";
import { generateJobNumber } from "@/lib/utils";
import type { JobType, JobStatus } from "@prisma/client";

export async function createJob(data: {
  propertyId: string;
  jobType: JobType;
  scheduledDate: Date;
  startTime?: string;
  endTime?: string;
  dueTime?: string;
  estimatedHours?: number;
  notes?: string;
  internalNotes?: string;
  priorityBucket?: number;
  priorityReason?: string;
  sameDayCheckin?: boolean;
  sameDayCheckinTime?: string;
  requiresSafetyCheckin?: boolean;
  reservationId?: string;
}) {
  const jobNumber = generateJobNumber();

  return prisma.job.create({
    data: {
      jobNumber,
      propertyId: data.propertyId,
      jobType: data.jobType,
      scheduledDate: data.scheduledDate,
      startTime: data.startTime,
      endTime: data.endTime,
      dueTime: data.dueTime,
      estimatedHours: data.estimatedHours,
      notes: data.notes,
      internalNotes: data.internalNotes,
      priorityBucket: data.priorityBucket ?? 4,
      priorityReason: data.priorityReason,
      sameDayCheckin: data.sameDayCheckin ?? false,
      sameDayCheckinTime: data.sameDayCheckinTime,
      requiresSafetyCheckin: data.requiresSafetyCheckin ?? false,
      reservationId: data.reservationId,
    },
  });
}

export async function assignJob(jobId: string, userId: string, isPrimary: boolean = true, assignedById?: string) {
  return prisma.jobAssignment.create({
    data: {
      jobId,
      userId,
      isPrimary,
      assignedById,
    },
  });
}

export async function updateJobStatus(jobId: string, status: JobStatus, updatedBy?: string) {
  const updateData: Record<string, unknown> = { status };

  if (status === "COMPLETED" || status === "INVOICED") {
    // Could trigger report generation here
  }

  if (updatedBy) {
    updateData.manuallyRescheduledAt = new Date();
    updateData.rescheduledBy = updatedBy;
  }

  return prisma.job.update({
    where: { id: jobId },
    data: updateData,
  });
}

export async function getJobWithDetails(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      property: {
        include: {
          client: true,
          integration: true,
        },
      },
      assignments: {
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      },
      timeLogs: true,
      formSubmissions: {
        include: {
          submittedBy: { select: { id: true, name: true } },
          media: true,
        },
      },
      jobTasks: {
        include: {
          attachments: true,
          events: true,
        },
      },
      laundryTask: true,
      report: true,
      feedback: true,
      satisfactionRating: true,
    },
  });
}

export async function getJobsForDate(date: Date, filters?: {
  status?: JobStatus[];
  propertyId?: string;
  jobType?: JobType;
}) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return prisma.job.findMany({
    where: {
      scheduledDate: { gte: startOfDay, lte: endOfDay },
      ...(filters?.status && { status: { in: filters.status } }),
      ...(filters?.propertyId && { propertyId: filters.propertyId }),
      ...(filters?.jobType && { jobType: filters.jobType }),
    },
    include: {
      property: { select: { name: true, address: true, suburb: true, latitude: true, longitude: true } },
      assignments: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: [{ priorityBucket: "asc" }, { scheduledDate: "asc" }],
  });
}
