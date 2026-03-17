import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  deleteClientApprovalById,
  getClientApprovalById,
  updateClientApprovalById,
} from "@/lib/commercial/client-approvals";

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
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getClientApprovalById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateClientApprovalById(params.id, body);
    if (!updated) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
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
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const ok = await deleteClientApprovalById(params.id);
    if (!ok) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Delete failed." }, { status });
  }
}
