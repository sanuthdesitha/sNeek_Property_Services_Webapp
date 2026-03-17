import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  deleteBranchById,
  getBranchById,
  updateBranchById,
} from "@/lib/phase3/branches";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  code: z.string().trim().max(32).optional(),
  isActive: z.boolean().optional(),
  suburbs: z.array(z.string().trim().min(1).max(80)).optional(),
  propertyIds: z.array(z.string().trim().min(1)).optional(),
  userIds: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getBranchById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateBranchById(params.id, body);
    if (!updated) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BRANCH_UPDATE",
        entity: "Branch",
        entityId: updated.id,
        before: existing as any,
        after: updated as any,
      },
    });
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
    const existing = await getBranchById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }
    const ok = await deleteBranchById(params.id);
    if (!ok) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BRANCH_DELETE",
        entity: "Branch",
        entityId: params.id,
        before: existing as any,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Delete failed." }, { status });
  }
}

