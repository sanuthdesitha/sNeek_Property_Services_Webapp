import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  decideContinuationRequest,
  getContinuationRequestById,
} from "@/lib/jobs/continuation-requests";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  decisionNote: z.string().trim().max(2000).optional().nullable(),
  newScheduledDate: z.string().date().optional().nullable(),
  newCleanerId: z.string().trim().optional().nullable(),
  previousCleanerHours: z.number().nonnegative().max(24).optional().nullable(),
  newCleanerHours: z.number().nonnegative().max(24).optional().nullable(),
  newCleanerPayRate: z.number().nonnegative().max(1000).optional().nullable(),
  transportAllowance: z.number().nonnegative().max(500).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const before = await getContinuationRequestById(params.id);
    if (!before) {
      return NextResponse.json({ error: "Continuation request not found." }, { status: 404 });
    }

    const decided = await decideContinuationRequest({
      id: params.id,
      decision: body.decision,
      decidedByUserId: session.user.id,
      decisionNote: body.decisionNote ?? null,
      newScheduledDate: body.newScheduledDate ?? null,
      newCleanerId: body.newCleanerId ?? null,
      previousCleanerHours: body.previousCleanerHours ?? null,
      newCleanerHours: body.newCleanerHours ?? null,
      newCleanerPayRate: body.newCleanerPayRate ?? null,
      transportAllowance: body.transportAllowance ?? null,
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: decided.jobId,
        action: "JOB_CONTINUATION_DECISION",
        entity: "JobContinuationRequest",
        entityId: decided.id,
        before: before as any,
        after: decided as any,
      },
    });

    await db.notification.create({
      data: {
        userId: decided.requestedByUserId,
        jobId: decided.jobId,
        channel: NotificationChannel.PUSH,
        subject:
          decided.status === "APPROVED"
            ? "Continuation approved"
            : "Continuation request declined",
        body:
          decided.status === "APPROVED"
            ? `A continuation has been scheduled for your job (${decided.continuationJobId ?? "-"})`
            : decided.decisionNote ?? "Admin declined this request.",
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    return NextResponse.json(decided);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not decide continuation request." }, { status });
  }
}

