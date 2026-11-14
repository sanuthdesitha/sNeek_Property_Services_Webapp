import { NextRequest, NextResponse } from "next/server";
import { Role, GatewayStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";

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

/**
 * Tier C (2026-11-14, simpler confirmations): the administrator's own PIN (their
 * password while they have none) is sent as `{ security }` and verified here,
 * in the same request, instead of a browser pre-check against the verify endpoint.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const refusal = await routeSecurityRefusal(session, securityFromBody(await req.json().catch(() => ({}))) ?? null);
    if (refusal) return refusal;
    await db.paymentGateway.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete gateway." }, { status });
  }
}
