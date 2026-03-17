import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  deleteSupplierById,
  getSupplierById,
  updateSupplierById,
} from "@/lib/inventory/suppliers";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(64).optional().nullable(),
  website: z.string().trim().max(400).optional().nullable(),
  defaultLeadDays: z.number().int().min(0).max(60).optional(),
  categories: z.array(z.string().trim().min(1).max(80)).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getSupplierById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }

    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateSupplierById(params.id, body);
    if (!updated) {
      return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SUPPLIER_UPDATE",
        entity: "SupplierCatalog",
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
    const existing = await getSupplierById(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }
    const ok = await deleteSupplierById(params.id);
    if (!ok) {
      return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SUPPLIER_DELETE",
        entity: "SupplierCatalog",
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
