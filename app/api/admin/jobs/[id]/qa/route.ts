import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, JobStatus } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";
import { awardLoyaltyForCompletedJob } from "@/lib/client/rewards";
import { scheduleJobFollowUps } from "@/lib/ops/follow-up-sequences";
import { logger } from "@/lib/logger";
import {
  autoResolveJobCases,
  findOpenAutoCase,
  meetsAutoOpenThreshold,
} from "@/lib/cases/auto-case";

const qaSchema = z.object({
  score: z.number().min(0).max(100),
  notes: z.string().optional(),
  flags: z.array(z.string()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = qaSchema.parse(await req.json());
    const settings = await getAppSettings();

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        propertyId: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        estimatedHours: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const passed = body.score >= settings.qaAutomation.failureThreshold;

    // CORE: the QA review + job status must always commit. A new review is
    // appended each time (the latest supersedes any earlier quick/auto review).
    const qa = await db.$transaction(async (tx) => {
      const createdReview = await tx.qAReview.create({
        data: {
          jobId: params.id,
          reviewedById: session.user.id,
          score: body.score,
          passed,
          notes: body.notes,
          flags: body.flags ?? [],
        },
      });

      await tx.job.update({
        where: { id: params.id },
        data: {
          status: passed ? JobStatus.COMPLETED : JobStatus.QA_REVIEW,
          // Stamp the completion date used for payroll + invoice periods.
          completedAt: passed ? new Date() : null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action: "QA_REVIEW",
          entity: "Job",
          entityId: params.id,
          after: {
            score: body.score,
            passed,
            threshold: settings.qaAutomation.failureThreshold,
          } as any,
        },
      });

      return createdReview;
    });

    // BEST-EFFORT AUTOMATION: an issue-ticket or rework-job failure must never
    // roll back the QA review itself, so these run outside the core transaction
    // and each is individually guarded + logged.
    let reworkJobId: string | null = null;
    if (
      !passed &&
      settings.qaAutomation.createIssueTicket &&
      // Respect the case-automation threshold (QA fails are HIGH severity).
      meetsAutoOpenThreshold("HIGH", settings.caseAutomation)
    ) {
      try {
        // DEDUPE: never open a second open QA case for this job. The legacy
        // OPS-type check is kept, plus the shared job+type guard.
        const existingIssue =
          (await db.issueTicket.findFirst({
            where: { jobId: params.id, caseType: "OPS", status: { not: "RESOLVED" } },
            select: { id: true },
          })) ??
          (settings.caseAutomation.dedupeByJobAndType
            ? await findOpenAutoCase({ jobId: params.id, titlePrefix: "QA Below Threshold" })
            : null);
        if (!existingIssue) {
          const jobNumber = await db.job.findUnique({
            where: { id: params.id },
            select: { jobNumber: true },
          });
          await db.issueTicket.create({
            data: {
              jobId: params.id,
              title: `QA Below Threshold - ${jobNumber?.jobNumber ?? params.id.slice(-6)}`,
              description: `Auto-generated from QA score of ${body.score}%.`,
              caseType: "OPS",
              source: "QA_AUTOMATION",
              severity: "HIGH",
              status: "OPEN",
              state: "OPEN",
              clientVisible: false,
            },
          });
        }
      } catch (err) {
        logger.error({ err, jobId: params.id }, "QA automation: issue-ticket creation failed (non-fatal)");
      }
    }

    // SELF-HEAL: a re-review that now passes should auto-resolve the QA case
    // the previous failure opened, instead of leaving it stale.
    if (passed && settings.caseAutomation.autoResolveOnClear) {
      try {
        await autoResolveJobCases({
          jobId: params.id,
          titlePrefix: "QA Below Threshold",
          reason: `QA re-review passed with a score of ${body.score}% (threshold ${settings.qaAutomation.failureThreshold}%).`,
          actorId: session.user.id,
        });
      } catch (err) {
        logger.error({ err, jobId: params.id }, "QA automation: case self-heal failed (non-fatal)");
      }
    }

    if (!passed && settings.qaAutomation.autoCreateReworkJob) {
      try {
        const reworkTag = `rework-of:${job.id}`;
        const existingRework = await db.job.findFirst({
          where: {
            propertyId: job.propertyId,
            jobType: job.jobType,
            internalNotes: { contains: reworkTag },
            status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
          },
          select: { id: true },
        });
        if (!existingRework) {
          const nextScheduledDate = new Date(
            job.scheduledDate.getTime() + settings.qaAutomation.reworkDelayHours * 3600_000
          );
          const notes = serializeJobInternalNotes({
            internalNoteText: `Auto-generated rework for job ${job.id}.`,
            tags: ["auto-rework", reworkTag],
          });
          reworkJobId = await db.$transaction(async (tx) => {
            const jobNumber = await reserveJobNumber(tx);
            const reworkJob = await tx.job.create({
              data: {
                jobNumber,
                propertyId: job.propertyId,
                jobType: job.jobType,
                status: JobStatus.UNASSIGNED,
                scheduledDate: nextScheduledDate,
                startTime: job.startTime,
                dueTime: job.dueTime,
                estimatedHours: job.estimatedHours,
                notes: "Auto rework job from failed QA.",
                internalNotes: notes,
              },
            });
            return reworkJob.id;
          });
        }
      } catch (err) {
        logger.error({ err, jobId: params.id }, "QA automation: rework-job creation failed (non-fatal)");
      }
    }

    if (passed) {
      await Promise.allSettled([
        awardLoyaltyForCompletedJob(params.id),
        scheduleJobFollowUps(params.id),
      ]);
    }
    if (reworkJobId) {
      await assignPreferredCleanerIfAvailable({
        jobId: reworkJobId,
        propertyId: job.propertyId,
        jobType: job.jobType,
      }).catch(() => null);
    }

    return NextResponse.json(qa);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
