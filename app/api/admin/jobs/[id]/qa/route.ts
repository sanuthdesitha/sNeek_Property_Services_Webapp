import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, JobStatus } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { awardLoyaltyForCompletedJob } from "@/lib/client/rewards";
import { scheduleJobFollowUps } from "@/lib/ops/follow-up-sequences";
import { logger } from "@/lib/logger";
import {
  autoResolveJobCases,
  findOpenAutoCase,
  meetsAutoOpenThreshold,
} from "@/lib/cases/auto-case";
import { recomputeJobQaOutcome } from "@/lib/qa/authority";
import { getAdminReworkContext } from "@/lib/qa/admin-rework";

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

    // A QA review only applies to a job that has been submitted (SUBMITTED /
    // QA_REVIEW) or is being re-reviewed (COMPLETED). Scoring any other status
    // would fabricate a completion — e.g. flip an UNASSIGNED/IN_PROGRESS job to
    // COMPLETED with no cleaner work, or REOPEN a locked INVOICED job.
    const QA_REVIEWABLE: JobStatus[] = [
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
    ];
    if (!QA_REVIEWABLE.includes(job.status)) {
      return NextResponse.json(
        {
          error: `This job is ${job.status.replace(/_/g, " ").toLowerCase()} and can't be QA-scored. It must be submitted first.`,
        },
        { status: 409 }
      );
    }

    const passed = body.score >= settings.qaAutomation.failureThreshold;

    // CORE: the QA review + job status must always commit. A new review is
    // appended each time (the latest supersedes any earlier quick/auto review)
    // — EXCEPT an identical save moments after the last one, which is a
    // double-click, not a re-review. Pressing Save twice used to file two
    // reviews and the cleaner saw duplicate feedback for one clean.
    const IDEMPOTENCY_WINDOW_MS = 2 * 60_000;
    const qa = await db.$transaction(async (tx) => {
      // Serialize concurrent saves for this job so a double-click's second
      // request queues behind the first and sees its review.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.id}))`;
      const recentDuplicate = await tx.qAReview.findFirst({
        where: {
          jobId: params.id,
          reviewedById: session.user.id,
          kind: "ADMIN",
          score: body.score,
          createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
      });
      if (recentDuplicate) return { review: recentDuplicate, duplicate: true as const };

      const createdReview = await tx.qAReview.create({
        data: {
          jobId: params.id,
          reviewedById: session.user.id,
          score: body.score,
          passed,
          // Admin/ops quick score — a real on-site QA inspection (kind "QA")
          // outranks this (see lib/qa/authority.ts).
          kind: "ADMIN",
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

      return { review: createdReview, duplicate: false as const };
    });

    // A deduped save already did all of this the first time — re-running the
    // automation would double the loyalty award and client emails.
    if (qa.duplicate) {
      return NextResponse.json({ ...qa.review, duplicate: true, reworkPrompt: null });
    }

    // Respect QA authority: if a real on-site QA inspection already exists for
    // this job, it remains the authoritative score — this admin quick-score does
    // not override it. (No-op when this is the only/highest review.)
    await recomputeJobQaOutcome(params.id).catch(() => null);

    // BEST-EFFORT AUTOMATION: an issue-ticket failure must never roll back the
    // QA review itself, so these run outside the core transaction and each is
    // individually guarded + logged.
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

    // REWORK IS NEVER AUTOMATIC FROM THIS SURFACE.
    //
    // A failing score used to create a rework job on its own, purely because
    // `qaAutomation.autoCreateReworkJob` defaults to true. That silently
    // schedules a real job, assigns a cleaner and emails the client twice — far
    // too much to hang off a typed number, and it overruled the QA inspector,
    // whose own workspace has an explicit rework decision that this path never
    // read. A low score with the inspector deliberately NOT requesting rework
    // is a normal outcome, not an oversight to correct.
    //
    // So a fail now RETURNS the facts and lets the admin decide. Creation
    // happens only when they confirm, via POST …/qa/rework.
    let reworkPrompt: {
      score: number;
      threshold: number;
      inspectorReviewed: boolean;
      inspectorRequestedRework: boolean;
      existingReworkJobId: string | null;
    } | null = null;
    //
    // The `autoCreateReworkJob` setting is still honoured, but now as "offer
    // rework on a fail" rather than "do it silently": an admin who turned it
    // off is not asked either.
    if (!passed && settings.qaAutomation.autoCreateReworkJob) {
      try {
        const context = await getAdminReworkContext(job);
        reworkPrompt = {
          score: body.score,
          threshold: settings.qaAutomation.failureThreshold,
          inspectorReviewed: context.inspectorReviewed,
          inspectorRequestedRework: context.inspectorRequestedRework,
          existingReworkJobId: context.existingReworkJobId,
        };
      } catch (err) {
        logger.error({ err, jobId: params.id }, "QA: rework context lookup failed (non-fatal)");
      }
    }

    if (passed) {
      await Promise.allSettled([
        awardLoyaltyForCompletedJob(params.id),
        scheduleJobFollowUps(params.id),
      ]);
    }

    return NextResponse.json({ ...qa.review, reworkPrompt });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
