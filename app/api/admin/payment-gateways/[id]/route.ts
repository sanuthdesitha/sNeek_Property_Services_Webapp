import { NextRequest, NextResponse } from "next/server";
import { Role, GatewayStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN]);
    const body = z.object({
      status: z.nativeEnum(GatewayStatus).optional(),
      label: z.string().trim().min(1).optional(),
      credentials: z.record(z.unknown()).optional(),
      feeRate: z.number().min(0).optional(),
      fixedFee: z.number().min(0).optional(),
      surchargeEnabled: z.boolean().optional(),
      priority: z.number().int().optional(),
    }).parse(await req.json());

    const gateway = await db.paymentGateway.update({
      where: { id: params.id },
      data: body as any,
    });

    return NextResponse.json(gateway);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update gateway." }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN]);
    await db.paymentGateway.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete gateway." }, { status });
  }
}
