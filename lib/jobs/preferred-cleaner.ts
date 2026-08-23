import {
  JobAssignmentResponseStatus,
  JobStatus,
  type JobType,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { derivePreStartJobStatus } from "@/lib/jobs/assignment-workflow";
import { resolveAssignmentPayRate } from "@/lib/finance/assignment-rate";

type PrismaLikeClient = Prisma.TransactionClient | typeof db;

export async function assignPreferredCleanerIfAvailable(input: {
  client?: PrismaLikeClient;
  jobId: string;
  propertyId: string;
  jobType: JobType;
}) {
  const client = input.client ?? db;
  const [settings, property, job] = await Promise.all([
    getAppSettings(),
    client.property.findUnique({
      where: { id: input.propertyId },
      // cleanerServiceRate rides along for the pay snapshot below. This path
      // auto-assigns on job creation, so leaving it out would mean the property
      // rate applied to hand-assigned jobs and silently not to iCal ones — the
      // same property paying two different rates depending on how the job was
      // created.
      select: { preferredCleanerUserId: true, cleanerServiceRate: true },
    }),
    client.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, status: true },
    }),
  ]);

  const cleanerId = property?.preferredCleanerUserId ?? null;
  if (!job?.id || !cleanerId) {
    return { assigned: false, reason: "no_preferred_cleaner" as const };
  }

  const cleaner = await client.user.findFirst({
    where: {
      id: cleanerId,
      role: "CLEANER",
      isActive: true,
    },
    select: { id: true },
  });
  if (!cleaner) {
    return { assigned: false, reason: "preferred_cleaner_inactive" as const };
  }

  // Same precedence and the same dispatch-time snapshot as the admin assign
  // route: per-cleaner job-type rate first, then the property's own rate. A
  // stored 0 counts as unset — the property form has no way to say "this one
  // pays nothing".
  const configuredRate =
    resolveAssignmentPayRate({
      perCleanerRate: settings.cleanerJobHourlyRates?.[cleaner.id]?.[input.jobType],
      propertyCleanerServiceRate: property?.cleanerServiceRate,
    }) ?? undefined;
  const changedAt = new Date();
  await client.jobAssignment.upsert({
    where: { jobId_userId: { jobId: input.jobId, userId: cleaner.id } },
    create: {
      jobId: input.jobId,
      userId: cleaner.id,
      isPrimary: true,
      payRate: configuredRate,
      offeredAt: changedAt,
      responseStatus: JobAssignmentResponseStatus.PENDING,
    },
    update: {
      removedAt: null,
      isPrimary: true,
      payRate: configuredRate,
      offeredAt: changedAt,
      responseStatus: JobAssignmentResponseStatus.PENDING,
      respondedAt: null,
      responseNote: null,
      transferredFromUserId: null,
    },
  });

  if (job.status === JobStatus.UNASSIGNED || job.status === JobStatus.OFFERED || job.status === JobStatus.ASSIGNED) {
    const activeAssignments = await client.jobAssignment.findMany({
      where: { jobId: input.jobId, removedAt: null },
      select: { removedAt: true, responseStatus: true },
    });
    await client.job.update({
      where: { id: input.jobId },
      data: {
        status: derivePreStartJobStatus(job.status, activeAssignments),
      },
    });
  }

  return { assigned: true, cleanerId: cleaner.id };
}
