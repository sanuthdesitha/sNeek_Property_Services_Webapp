import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, JobStatus } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

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
        data: { status: passed ? JobStatus.COMPLETED : JobStatus.QA_REVIEW },
      });

      if (!passed) {
        if (settings.qaAutomation.createIssueTicket) {
          const existingIssue = await tx.issueTicket.findFirst({
            where: {
              jobId: params.id,
              status: { not: "RESOLVED" },
              title: { startsWith: "QA failed" },
            },
            select: { id: true },
          });
          if (!existingIssue) {
            await tx.issueTicket.create({
              data: {
                jobId: params.id,
                title: "QA failed - rework required",
                description:
                  body.notes?.trim() ||
                  `QA score ${body.score} below threshold ${settings.qaAutomation.failureThreshold}.`,
                severity: "HIGH",
                status: "OPEN",
              },
            });
          }
        }

        if (settings.qaAutomation.autoCreateReworkJob) {
          const reworkTag = `rework-of:${job.id}`;
          const existingRework = await tx.job.findFirst({
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
            await tx.job.create({
              data: {
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
          }
        }
      }

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

    return NextResponse.json(qa);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
