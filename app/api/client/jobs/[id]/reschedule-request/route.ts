import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { createClientJobTaskRequest } from "@/lib/job-tasks/service";

const schema = z.object({
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const BLOCKED_STATUSES: JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
        const portal = await requireClientPortal({ permission: "bookings" });

    const body = schema.parse(await req.json().catch(() => ({})));
    const job = await db.job.findFirst({
      where: {
        id: params.id,
        property: propertyScopeWhere(portal),
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (BLOCKED_STATUSES.includes(job.status)) {
      return NextResponse.json({ error: "This job can no longer be rescheduled from the client portal." }, { status: 400 });
    }

    const task = await createClientJobTaskRequest({
      jobId: job.id,
      clientId: portal.clientId,
      requestedByUserId: portal.userId,
      title: "Reschedule request",
      description: `Client requested a date change to ${body.requestedDate}${body.startTime ? ` at ${body.startTime}` : ""}.`,
      metadata: {
        type: "RESCHEDULE_REQUEST",
        requestedDate: body.requestedDate,
        requestedStartTime: body.startTime ?? null,
      },
      baseUrl: req,
    });

    return NextResponse.json({ ok: true, taskId: task.id });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: error?.message ?? "Could not send reschedule request." },
      { status }
    );
  }
}
