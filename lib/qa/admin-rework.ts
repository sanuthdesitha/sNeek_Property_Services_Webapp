import "server-only";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import type { AppSettings } from "@/lib/settings";

/**
 * Rework creation from an ADMIN quick QA score.
 *
 * Previously a below-threshold score created a rework job on its own, with no
 * confirmation, purely because `qaAutomation.autoCreateReworkJob` defaults to
 * true. That is a costly thing to do silently: it schedules a real job, assigns
 * a cleaner, and emails the client twice (ISSUE_RAISED + RECLEAN_SCHEDULED). A
 * mistyped score was enough to trigger it.
 *
 * Worse, it ignored the QA inspector entirely. The inspector's workspace has an
 * explicit rework decision (app/api/qa/jobs/[id]/route.ts), and a low score with
 * the inspector deliberately NOT requesting rework is a normal outcome — the
 * clean was poor but does not warrant a return visit. The admin path overruled
 * that without ever reading it.
 *
 * So creation is now explicit, and the caller is told what the inspector
 * decided first.
 */

export type AdminReworkContext = {
  /** An open rework job already exists — creating another would duplicate it. */
  existingReworkJobId: string | null;
  /** A real on-site inspection (kind "QA") has been filed for this job. */
  inspectorReviewed: boolean;
  /**
   * The inspector actively asked for rework (a rework job or a rework transfer
   * exists from their submission). When false while `inspectorReviewed` is
   * true, they looked and chose not to — worth saying out loud before an admin
   * overrides it.
   */
  inspectorRequestedRework: boolean;
};

export function reworkTagFor(jobId: string): string {
  return `rework-of:${jobId}`;
}

export async function getAdminReworkContext(
  job: { id: string; propertyId: string; jobType: string },
): Promise<AdminReworkContext> {
  const [byLink, byTag, inspectorReview, transfer] = await Promise.all([
    // The modern link. Rework jobs created by the inspector path set this.
    db.job.findFirst({
      where: {
        reworkOfJobId: job.id,
        status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      select: { id: true },
    }),
    // The legacy tag, kept so jobs created before reworkOfJobId still dedupe.
    db.job.findFirst({
      where: {
        propertyId: job.propertyId,
        jobType: job.jobType as never,
        internalNotes: { contains: reworkTagFor(job.id) },
        status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      select: { id: true },
    }),
    db.qAReview.findFirst({
      where: { jobId: job.id, kind: "QA" },
      select: { id: true },
    }),
    db.qaReworkTransfer.findFirst({
      where: { jobId: job.id },
      select: { id: true },
    }),
  ]);

  const existingReworkJobId = byLink?.id ?? byTag?.id ?? null;
  return {
    existingReworkJobId,
    inspectorReviewed: Boolean(inspectorReview),
    // A linked rework job or a transfer both mean the inspector asked for one.
    inspectorRequestedRework: Boolean(byLink || transfer),
  };
}

/**
 * Creates the rework job. Returns null when one already exists, so a repeated
 * confirmation (double-click, retried request) cannot produce two.
 */
export async function createAdminReworkJob(args: {
  job: {
    id: string;
    propertyId: string;
    jobType: string;
    scheduledDate: Date;
    startTime: string | null;
    dueTime: string | null;
    estimatedHours: number | null;
  };
  settings: AppSettings;
  actorId: string;
}): Promise<string | null> {
  const { job, settings, actorId } = args;

  const context = await getAdminReworkContext(job);
  if (context.existingReworkJobId) return null;

  const nextScheduledDate = new Date(
    job.scheduledDate.getTime() + settings.qaAutomation.reworkDelayHours * 3600_000,
  );
  const notes = serializeJobInternalNotes({
    internalNoteText: `Rework for job ${job.id}, requested from an admin QA score.`,
    tags: ["auto-rework", reworkTagFor(job.id)],
  });

  return db.$transaction(async (tx) => {
    const jobNumber = await reserveJobNumber(tx);
    const reworkJob = await tx.job.create({
      data: {
        jobNumber,
        propertyId: job.propertyId,
        jobType: job.jobType as never,
        status: JobStatus.UNASSIGNED,
        scheduledDate: nextScheduledDate,
        startTime: job.startTime,
        dueTime: job.dueTime,
        estimatedHours: job.estimatedHours,
        notes: "Rework job from failed QA.",
        internalNotes: notes,
        // Marks a real rework so the cleaner gets the fix checklist and laundry
        // pickup is suppressed (both gate on isRework), and so the
        // QA-inspection dedupe (which keys on reworkOfJobId) sees this job.
        isRework: true,
        reworkOfJobId: job.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        jobId: job.id,
        action: "QA_REWORK_CREATED",
        entity: "Job",
        entityId: reworkJob.id,
        after: { reworkOfJobId: job.id, source: "ADMIN_QA_CONFIRMED" } as never,
      },
    });
    return reworkJob.id;
  });
}
