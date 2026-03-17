import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateJobSchema } from "@/lib/validations/job";
import { Role, JobStatus } from "@prisma/client";
import { z } from "zod";
import { applyJobTimingRules, parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";

function normalizeRule(
  rule:
    | {
        enabled?: boolean;
        preset?: "none" | "11:00" | "12:30" | "custom";
        time?: string;
      }
    | undefined
) {
  if (!rule) return undefined;
  return {
    enabled: rule.enabled === true,
    preset: rule.preset ?? "none",
    time: rule.time,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const job = await db.job.findUnique({
      where: { id: params.id },
      include: {
        property: { include: { client: true, integration: true } },
        assignments: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true, role: true } },
          },
        },
        timeLogs: { include: { user: { select: { name: true } } } },
        formSubmissions: {
          include: {
            template: true,
            media: true,
            stockTxs: {
              include: {
                propertyStock: {
                  include: { item: true },
                },
              },
            },
            submittedBy: { select: { name: true } },
          },
        },
        qaReviews: true,
        laundryTask: true,
        report: true,
        issueTickets: true,
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      ...job,
      jobMeta: parseJobInternalNotes(job.internalNotes),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = updateJobSchema
      .extend({ confirmCompletedReset: z.boolean().optional() })
      .parse(await req.json());
    const { confirmCompletedReset, ...body } = parsed;
    const current = await db.job.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, internalNotes: true, startTime: true, dueTime: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (
      body.status === JobStatus.UNASSIGNED &&
      (current.status === JobStatus.COMPLETED || current.status === JobStatus.INVOICED) &&
      !confirmCompletedReset
    ) {
      return NextResponse.json(
        { error: "CONFIRM_COMPLETED_RESET_REQUIRED", message: "Confirm moving a completed job back to unassigned." },
        { status: 409 }
      );
    }

    const data: Record<string, unknown> = { ...body };
    const currentMeta = parseJobInternalNotes(current.internalNotes);
    const nextEarlyCheckin = normalizeRule(body.earlyCheckin) ?? currentMeta.earlyCheckin;
    const nextLateCheckout = normalizeRule(body.lateCheckout) ?? currentMeta.lateCheckout;
    if (body.scheduledDate) {
      data.scheduledDate = new Date(body.scheduledDate);
    }
    const hasMetaFields =
      body.internalNotes !== undefined ||
      body.isDraft !== undefined ||
      body.tags !== undefined ||
      body.attachments !== undefined ||
      body.transportAllowances !== undefined ||
      body.earlyCheckin !== undefined ||
      body.lateCheckout !== undefined;
    if (hasMetaFields) {
      data.internalNotes = serializeJobInternalNotes({
        ...currentMeta,
        internalNoteText: body.internalNotes ?? currentMeta.internalNoteText,
        isDraft: body.isDraft ?? currentMeta.isDraft,
        tags: body.tags ?? currentMeta.tags,
        attachments: body.attachments ?? currentMeta.attachments,
        transportAllowances: body.transportAllowances ?? currentMeta.transportAllowances,
        earlyCheckin: nextEarlyCheckin,
        lateCheckout: nextLateCheckout,
      });
    }
    const shouldApplyTiming =
      hasMetaFields || body.startTime !== undefined || body.dueTime !== undefined;
    if (shouldApplyTiming) {
      const timing = applyJobTimingRules({
        startTime: body.startTime ?? current.startTime,
        dueTime: body.dueTime ?? current.dueTime,
        earlyCheckin: nextEarlyCheckin,
        lateCheckout: nextLateCheckout,
      });
      data.startTime = timing.startTime ?? null;
      data.dueTime = timing.dueTime ?? null;
    }
    delete data.isDraft;
    delete data.tags;
    delete data.attachments;
    delete data.transportAllowances;
    delete data.earlyCheckin;
    delete data.lateCheckout;

    const job = await db.job.update({
      where: { id: params.id },
      data,
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: "UPDATE_JOB",
        entity: "Job",
        entityId: params.id,
        after: data as any,
      },
    });

    return NextResponse.json(job);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobId = params.id;

    const existing = await db.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      await tx.stockTx.deleteMany({ where: { submission: { jobId } } });
      await tx.submissionMedia.deleteMany({ where: { submission: { jobId } } });
      await tx.formSubmission.deleteMany({ where: { jobId } });
      await tx.timeLog.deleteMany({ where: { jobId } });
      await tx.jobAssignment.deleteMany({ where: { jobId } });
      await tx.qAReview.deleteMany({ where: { jobId } });
      await tx.issueTicket.deleteMany({ where: { jobId } });
      await tx.report.deleteMany({ where: { jobId } });
      await tx.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId } } });
      await tx.laundryTask.deleteMany({ where: { jobId } });
      await tx.auditLog.deleteMany({ where: { jobId } });
      await tx.job.delete({ where: { id: jobId } });
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE_JOB",
        entity: "Job",
        entityId: jobId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
