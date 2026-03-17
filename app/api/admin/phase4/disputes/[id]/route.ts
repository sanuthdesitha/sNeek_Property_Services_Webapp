import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { deleteDispute, getDisputeById, patchDispute } from "@/lib/phase4/disputes";

const patchSchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  assignedToUserId: z.string().trim().optional().nullable(),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
  comment: z.string().trim().max(2000).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const row = await getDisputeById(params.id);
    if (!row) return NextResponse.json({ error: "Dispute not found." }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load dispute." }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const updated = await patchDispute(params.id, {
      status: body.status,
      priority: body.priority,
      assignedToUserId: body.assignedToUserId ?? undefined,
      resolutionNote: body.resolutionNote ?? undefined,
      addComment: body.comment?.trim()
        ? {
            authorUserId: session.user.id,
            body: body.comment,
          }
        : null,
    });
    if (!updated) return NextResponse.json({ error: "Dispute not found." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update dispute." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const ok = await deleteDispute(params.id);
    if (!ok) return NextResponse.json({ error: "Dispute not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete dispute." }, { status });
  }
}

