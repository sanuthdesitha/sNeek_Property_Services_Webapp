import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const patchSchema = z.object({
  baseRate: z.number().nonnegative().optional(),
  addOns: z.record(z.number().nonnegative()).optional(),
  multipliers: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN]);
    const body = patchSchema.parse(await req.json());
    const row = await db.priceBook.update({
      where: { id: params.id },
      data: body as any,
    });
    return NextResponse.json(row);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
