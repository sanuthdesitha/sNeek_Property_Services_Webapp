import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { createClientJobTaskRequest } from "@/lib/job-tasks/service";
import { checkClientJobRequest } from "@/lib/jobs/client-request-rules";

const schema = z.object({
  reason: z.string().trim().min(2).max(500),
});

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
    // 409, not 400: the request was well formed, the job simply moved on.
    const verdict = checkClientJobRequest("cancel", job);
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason }, { status: 409 });
    }

    const task = await createClientJobTaskRequest({
      jobId: job.id,
      clientId: portal.clientId,
      requestedByUserId: portal.userId,
      title: "Cancellation request",
      description: `Client requested cancellation. Reason: ${body.reason}`,
      // Tagged so the task layer can tell a scheduling request from cleaner
      // work. Untagged, this became a checklist item asking a cleaner to
      // photograph a cancellation.
      metadata: { type: "CANCELLATION_REQUEST", reason: body.reason },
      baseUrl: req,
    });

    return NextResponse.json({ ok: true, taskId: task.id });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: error?.message ?? "Could not send cancellation request." },
      { status }
    );
  }
}
