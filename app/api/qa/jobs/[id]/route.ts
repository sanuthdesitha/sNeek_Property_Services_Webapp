import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { buildDefaultQaTemplateSchema, scoreQaSubmission } from "@/lib/qa/templates";
import { generateJobReport } from "@/lib/reports/generator";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

const submitSchema = z.object({
  assignmentId: z.string().trim().min(1).nullable().optional(),
  templateId: z.string().trim().min(1),
  data: z.record(z.unknown()),
  media: z.any().optional(),
  notes: z.string().trim().max(6000).optional(),
});

async function resolveTemplate(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { jobType: true, propertyId: true },
  });
  if (!job) return null;
  const propertyTemplate = await db.qaFormTemplate.findFirst({
    where: { propertyId: job.propertyId, serviceType: job.jobType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (propertyTemplate) return propertyTemplate;
  const globalTemplate = await db.qaFormTemplate.findFirst({
    where: { propertyId: null, serviceType: job.jobType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (globalTemplate) return globalTemplate;
  return db.qaFormTemplate.create({
    data: {
      name: `Default QA - ${String(job.jobType).replace(/_/g, " ")}`,
      serviceType: job.jobType,
      schema: buildDefaultQaTemplateSchema(job.jobType) as any,
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const [job, template, assignment, mediaOverrides] = await Promise.all([
      db.job.findUnique({
        where: { id: params.id },
        include: {
          property: { select: { name: true, address: true, suburb: true, accessInfo: true } },
          assignments: {
            where: { removedAt: null },
            select: { user: { select: { id: true, name: true, email: true } } },
          },
          jobTasks: true,
          laundryTask: { include: { confirmations: { orderBy: { createdAt: "desc" }, take: 1 } } },
          issueTickets: { orderBy: { createdAt: "desc" }, take: 10 },
          formSubmissions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { media: true, submittedBy: { select: { name: true, email: true } } },
          },
          qaReviews: { orderBy: { createdAt: "desc" }, take: 5 },
          qaFormSubmissions: { orderBy: { createdAt: "desc" }, take: 5, include: { submittedBy: { select: { name: true, email: true } } } },
        },
      }),
      resolveTemplate(params.id),
      db.qaAssignment.findFirst({
        where: {
          jobId: params.id,
          status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
          OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
        },
      }),
      db.mediaOverrideRequest.findMany({
        where: { jobId: params.id },
        include: {
          requestedBy: { select: { name: true, email: true } },
          decidedBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!job || !template) return NextResponse.json({ error: "QA job not found." }, { status: 404 });
    return NextResponse.json({ job, template, assignment, mediaOverrides });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const body = submitSchema.parse(await req.json());
    const template = await db.qaFormTemplate.findUnique({ where: { id: body.templateId } });
    if (!template) return NextResponse.json({ error: "QA template not found." }, { status: 404 });
    const result = scoreQaSubmission(template.schema as any, body.data);

    const created = await db.$transaction(async (tx) => {
      const review = await tx.qAReview.create({
        data: {
          jobId: params.id,
          reviewedById: session.user.id,
          score: result.score,
          passed: result.passed,
          notes: body.notes || null,
          flags: { categoryScores: result.categoryScores, data: body.data } as any,
        },
      });
      const submission = await tx.qaFormSubmission.create({
        data: {
          jobId: params.id,
          templateId: template.id,
          assignmentId: body.assignmentId || undefined,
          qaReviewId: review.id,
          submittedById: session.user.id,
          data: body.data as any,
          categoryScores: result.categoryScores as any,
          media: body.media as any,
          score: result.score,
          passed: result.passed,
          notes: body.notes || null,
        },
      });
      if (body.assignmentId) {
        await tx.qaAssignment.update({
          where: { id: body.assignmentId },
          data: {
            status: QaAssignmentStatus.COMPLETED,
            completedAt: new Date(),
            pickedUpById: session.user.id,
          },
        });
      }
      await tx.job.update({
        where: { id: params.id },
        data: { status: result.passed ? JobStatus.COMPLETED : JobStatus.QA_REVIEW },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "QA_FORM_SUBMIT",
          entity: "QaFormSubmission",
          entityId: submission.id,
          after: { score: result.score, passed: result.passed, jobId: params.id } as any,
        },
      });
      return { review, submission };
    });

    await generateJobReport(params.id).catch(() => null);
    return NextResponse.json(created);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
