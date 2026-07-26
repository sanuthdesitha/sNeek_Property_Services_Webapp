import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { reviewJobTaskRequest } from "@/lib/job-tasks/service";
import { recordApprovalDecision } from "@/lib/admin/approval-history-write";

const updateSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(4000).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const updated = await reviewJobTaskRequest({
      taskId: params.id,
      actorUserId: session.user.id,
      decision: body.decision,
      note: body.note ?? null,
      baseUrl: req,
    });

    // Reschedules and light client requests are BOTH JobTasks and share this
    // route; the queue is distinguished by the same metadata shape
    // /api/admin/all-approvals splits on, so history rows land in the tab the
    // admin actually decided them in.
    const meta = ((updated as any)?.metadata ?? null) as Record<string, unknown> | null;
    void recordApprovalDecision({
      queue: meta?.type === "RESCHEDULE_REQUEST" ? "rescheduleRequests" : "clientRequests",
      decision: body.decision === "APPROVE" ? "APPROVED" : "DECLINED",
      userId: session.user.id,
      entity: "JobTask",
      entityId: params.id,
      jobId: (updated as any)?.jobId ?? null,
      label: (updated as any)?.title ?? "Client request",
      note: body.note ?? null,
      toStatus: (updated as any)?.approvalStatus ?? null,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not review task request." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
