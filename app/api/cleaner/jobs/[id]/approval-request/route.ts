import { NextRequest, NextResponse } from "next/server";
import { JobStatus, NotificationChannel, NotificationStatus, PayAdjustmentType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(6000).default(""),
  amount: z.number().min(0),
  currency: z.string().trim().max(8).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        assignments: {
          select: { userId: true, removedAt: true },
        },
        property: {
          select: { clientId: true, name: true, client: { select: { name: true } } },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status === JobStatus.UNASSIGNED) {
      return NextResponse.json(
        { error: "Extra payment requests are available only after the job is assigned." },
        { status: 400 }
      );
    }
    const activeAssignment = job.assignments.some(
      (assignment) => assignment.userId === session.user.id && !assignment.removedAt
    );
    if (!activeAssignment) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const requestedAmount = Number(body.amount ?? 0);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return NextResponse.json({ error: "Requested amount must be greater than 0." }, { status: 400 });
    }

    const cleanerNote = [body.title, body.description].filter(Boolean).join("\n\n").trim();
    const created = await db.cleanerPayAdjustment.create({
      data: {
        jobId: job.id,
        cleanerId: session.user.id,
        type: PayAdjustmentType.FIXED,
        requestedAmount,
        cleanerNote: cleanerNote || undefined,
      },
      select: { id: true, requestedAmount: true },
    });

    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((recipient) => ({
          userId: recipient.id,
          jobId: job.id,
          channel: NotificationChannel.PUSH,
          subject: "Cleaner extra pay request",
          body: `${job.property.name}: ${body.title} (${(body.currency ?? "AUD").toUpperCase()} ${requestedAmount.toFixed(
            2
          )})`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: job.id,
        action: "CLEANER_PAY_REQUEST_CREATED",
        entity: "CleanerPayAdjustment",
        entityId: created.id,
        after: {
          title: body.title,
          description: body.description,
          amount: requestedAmount,
          currency: body.currency ?? "AUD",
          routedTo: "PAY_REQUESTS_QUEUE",
        } as any,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        payRequestId: created.id,
        routedTo: "PAY_REQUESTS_QUEUE",
        message:
          "Pay request sent to admin. Clients are not contacted directly from cleaner actions.",
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create approval request." }, { status });
  }
}
