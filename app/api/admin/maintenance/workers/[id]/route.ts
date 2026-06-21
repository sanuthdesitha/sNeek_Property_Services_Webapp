import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  trade: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json());
    const worker = await db.maintenanceWorker.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.trade !== undefined ? { trade: body.trade } : {}),
        ...(body.company !== undefined ? { company: body.company } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    return NextResponse.json({ ok: true, id: worker.id });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
