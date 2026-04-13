import { NextRequest, NextResponse } from "next/server";
import { Role, GatewayProvider, GatewayStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const gateways = await db.paymentGateway.findMany({ orderBy: { priority: "asc" } });
    return NextResponse.json(gateways);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not list gateways." }, { status });
  }
}

const createSchema = z.object({
  provider: z.nativeEnum(GatewayProvider),
  label: z.string().trim().min(1),
  credentials: z.record(z.unknown()),
  feeRate: z.number().min(0).default(0.0175), // 1.75% default
  fixedFee: z.number().min(0).default(0.30), // $0.30 default
  surchargeEnabled: z.boolean().default(false),
  priority: z.number().int().default(0),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = createSchema.parse(await req.json());

    const gateway = await db.paymentGateway.create({
      data: {
        provider: body.provider,
        label: body.label,
        credentials: body.credentials as any,
        feeRate: body.feeRate,
        fixedFee: body.fixedFee,
        surchargeEnabled: body.surchargeEnabled,
        priority: body.priority,
        status: GatewayStatus.ACTIVE,
      },
    });

    return NextResponse.json(gateway, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create gateway." }, { status });
  }
}
