import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { upsertPropertyClientRate } from "@/lib/billing/client-invoices";

const schema = z.object({
  propertyId: z.string().trim().min(1),
  jobType: z.nativeEnum(JobType),
  baseCharge: z.number().min(0),
  billingUnit: z.string().trim().max(40).optional(),
  defaultDescription: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(
      await db.propertyClientRate.findMany({
        include: {
          property: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
        },
        orderBy: [{ property: { name: "asc" } }, { jobType: "asc" }],
      })
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load property rates." }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await upsertPropertyClientRate(body));
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not save property rate." }, { status: 400 });
  }
}
