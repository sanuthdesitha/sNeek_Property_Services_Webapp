import { NextRequest, NextResponse } from "next/server";
import { Role, JobType } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const createSchema = z.object({
  jobType: z.nativeEnum(JobType),
  bedrooms: z.number().int().nullable().optional(),
  bathrooms: z.number().int().nullable().optional(),
  baseRate: z.number().nonnegative(),
  addOns: z.record(z.number().nonnegative()),
  multipliers: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rows = await db.priceBook.findMany({
      orderBy: [{ jobType: "asc" }, { bedrooms: "asc" }, { bathrooms: "asc" }],
    });
    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = createSchema.parse(await req.json());
    const row = await db.priceBook.create({
      data: {
        jobType: body.jobType,
        bedrooms: body.bedrooms ?? null,
        bathrooms: body.bathrooms ?? null,
        baseRate: body.baseRate,
        addOns: body.addOns as any,
        multipliers: (body.multipliers ?? { conditionLevel: { light: 0.9, standard: 1.0, heavy: 1.3 } }) as any,
        isActive: body.isActive ?? true,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
