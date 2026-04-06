import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal("")),
  address: z.string().trim().max(300).optional().nullable(),
  pricePerKg: z.number().min(0).max(9999).optional().nullable(),
  avgTurnaround: z.number().int().min(0).max(9999).optional().nullable(),
  reliabilityScore: z.number().min(0).max(5).optional().nullable(),
  notes: z.string().trim().max(6000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const suppliers = await db.laundrySupplier.findMany({ orderBy: [{ name: "asc" }] });
    return NextResponse.json(suppliers);
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load suppliers." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = supplierSchema.parse(await req.json());
    const supplier = await db.laundrySupplier.create({
      data: {
        name: body.name,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        pricePerKg: body.pricePerKg ?? null,
        avgTurnaround: body.avgTurnaround ?? null,
        reliabilityScore: body.reliabilityScore ?? null,
        notes: body.notes || null,
        isActive: body.isActive !== false,
      },
    });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not create supplier." }, { status });
  }
}
