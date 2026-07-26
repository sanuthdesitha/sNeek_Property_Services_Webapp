import { NextRequest, NextResponse } from "next/server";
import { QaReworkTransferStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { reviewQaReworkTransfer } from "@/lib/qa/rework-transfers";
import { recordApprovalDecision } from "@/lib/admin/approval-history-write";

const patchSchema = z.object({
  status: z.union([
    z.literal(QaReworkTransferStatus.APPROVED),
    z.literal(QaReworkTransferStatus.REJECTED),
  ]),
  adminNote: z.string().trim().max(4000).optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const updated = await reviewQaReworkTransfer({
      id: params.id,
      reviewerUserId: session.user.id,
      status: body.status,
      adminNote: body.adminNote ?? null,
    });

    void recordApprovalDecision({
      queue: "qaReworkTransfers",
      decision: body.status === QaReworkTransferStatus.APPROVED ? "APPROVED" : "DECLINED",
      userId: session.user.id,
      entity: "QaReworkTransfer",
      entityId: params.id,
      jobId: (updated as any)?.jobId ?? null,
      label: "QA rework transfer",
      amount: (updated as any)?.payAmount ?? null,
      value: (updated as any)?.minutes ?? null,
      note: body.adminNote ?? null,
      subjectUserId: (updated as any)?.cleanerId ?? null,
      toStatus: body.status,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
