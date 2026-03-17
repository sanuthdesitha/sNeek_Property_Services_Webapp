import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { setInventoryItemUnitCost } from "@/lib/inventory/unit-costs";
import {
  INVENTORY_LOCATIONS,
  normalizeInventoryLocation,
} from "@/lib/inventory/locations";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  location: z.enum(INVENTORY_LOCATIONS).optional(),
  unit: z.string().min(1).optional(),
  supplier: z.string().optional(),
  isActive: z.boolean().optional(),
  unitCost: z.number().min(0).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json());
    const { unitCost, location, ...data } = body;
    const item = await db.inventoryItem.update({
      where: { id: params.id },
      data: {
        ...data,
        ...(location ? { location: normalizeInventoryLocation(location) } : {}),
      },
    });
    if (body.unitCost !== undefined) {
      await setInventoryItemUnitCost(params.id, unitCost);
    }
    return NextResponse.json({ ...item, unitCost: unitCost ?? null });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
