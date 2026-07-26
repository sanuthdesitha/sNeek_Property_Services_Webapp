import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  deleteClientApprovalById,
  getClientApprovalById,
  updateClientApprovalById,
} from "@/lib/commercial/client-approvals";
import { recordApprovalDecision } from "@/lib/admin/approval-history-write";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(6000).optional(),
  amount: z.number().min(0).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELLED", "EXPIRED"]).optional(),
  propertyId: z.string().trim().min(1).optional().nullable(),
  jobId: z.string().trim().min(1).optional().nullable(),
  quoteId: z.string().trim().min(1).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  responseNote: z.string().trim().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getClientApprovalById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateClientApprovalById(params.id, body);
    if (!updated) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    // Only a real status transition is a "decision" — a title/description tidy-up
    // is an edit, and the history must not read as if the item was re-approved.
    if (body.status && body.status !== existing.status) {
      void recordApprovalDecision({
        queue: "clientApprovals",
        decision:
          body.status === "APPROVED"
            ? "APPROVED"
            : body.status === "DECLINED"
            ? "DECLINED"
            : body.status === "PENDING"
            ? "REVERSED"
            : "DISMISSED",
        userId: session.user.id,
        entity: "ClientApproval",
        entityId: params.id,
        jobId: (updated as any)?.jobId ?? null,
        label: (updated as any)?.title ?? "Client approval",
        amount: (updated as any)?.amount ?? null,
        note: body.responseNote ?? null,
        fromStatus: (existing as any)?.status ?? null,
        toStatus: body.status,
      });
    } else if (body.amount !== undefined && body.amount !== (existing as any)?.amount) {
      void recordApprovalDecision({
        queue: "clientApprovals",
        decision: "EDITED",
        userId: session.user.id,
        entity: "ClientApproval",
        entityId: params.id,
        jobId: (updated as any)?.jobId ?? null,
        label: (updated as any)?.title ?? "Client approval",
        amount: body.amount,
        note: body.responseNote ?? null,
        fromStatus: (existing as any)?.status ?? null,
        toStatus: (updated as any)?.status ?? null,
      });
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getClientApprovalById(params.id);
    const ok = await deleteClientApprovalById(params.id);
    if (!ok) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    // The row is gone; the history row is now the ONLY record that it existed,
    // so it carries the label and amount it had at deletion time.
    void recordApprovalDecision({
      queue: "clientApprovals",
      decision: "DELETED",
      userId: session.user.id,
      entity: "ClientApproval",
      entityId: params.id,
      jobId: (existing as any)?.jobId ?? null,
      label: (existing as any)?.title ?? "Client approval",
      amount: (existing as any)?.amount ?? null,
      fromStatus: (existing as any)?.status ?? null,
      before: existing as any,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Delete failed." }, { status });
  }
}
