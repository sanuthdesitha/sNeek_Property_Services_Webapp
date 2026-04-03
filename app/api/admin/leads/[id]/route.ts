import { NextRequest, NextResponse } from "next/server";
import { LeadStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const patchSchema = z.object({
  status: z.nativeEnum(LeadStatus).optional(),
  notes: z.string().trim().max(12000).optional(),
  clientId: z.string().trim().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const lead = await db.quoteLead.update({
      where: { id: params.id },
      data: {
        status: body.status,
        notes: body.notes !== undefined ? body.notes || null : undefined,
        clientId: body.clientId !== undefined ? body.clientId || null : undefined,
      },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true } },
        quotes: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            validUntil: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ createdAt: "desc" }],
        },
      },
    });
    return NextResponse.json(lead);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err?.code === "P2025" ? 404 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update lead." }, { status });
  }
}
