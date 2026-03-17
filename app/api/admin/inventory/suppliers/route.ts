import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createSupplier, listSupplierCatalog } from "@/lib/inventory/suppliers";

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(64).optional().nullable(),
  website: z.string().trim().max(400).optional().nullable(),
  defaultLeadDays: z.number().int().min(0).max(60).optional(),
  categories: z.array(z.string().trim().min(1).max(80)).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const suppliers = await listSupplierCatalog();
    return NextResponse.json(suppliers);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createSupplier(body);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SUPPLIER_CREATE",
        entity: "SupplierCatalog",
        entityId: created.id,
        after: created as any,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Create failed." }, { status });
  }
}
