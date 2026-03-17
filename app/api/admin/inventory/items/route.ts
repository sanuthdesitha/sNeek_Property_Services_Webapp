import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role } from "@prisma/client";
import { getInventoryUnitCosts, setInventoryItemUnitCost } from "@/lib/inventory/unit-costs";
import { getApiErrorStatus } from "@/lib/api/http";
import {
  INVENTORY_LOCATIONS,
  normalizeInventoryLocation,
} from "@/lib/inventory/locations";

const itemSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().min(1),
  location: z.enum(INVENTORY_LOCATIONS).optional(),
  unit: z.string().default("unit"),
  supplier: z.string().optional(),
  unitCost: z.number().min(0).optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [items, unitCosts] = await Promise.all([
      db.inventoryItem.findMany({
        where: { isActive: true },
        orderBy: [{ location: "asc" }, { category: "asc" }, { name: "asc" }],
      }),
      getInventoryUnitCosts(),
    ]);
    const withCosts = items.map((item) => ({
      ...item,
      unitCost: typeof unitCosts[item.id] === "number" ? unitCosts[item.id] : null,
    }));
    return NextResponse.json(withCosts);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = itemSchema.parse(await req.json());
    const { unitCost, ...itemData } = body;
    const location = normalizeInventoryLocation(itemData.location);
    if (itemData.sku) {
      const existing = await db.inventoryItem.findUnique({ where: { sku: itemData.sku } });
      if (existing) {
        return NextResponse.json({ error: "SKU already exists." }, { status: 409 });
      }
    }
    const item = await db.inventoryItem.create({
      data: {
        ...itemData,
        location,
      },
    });
    if (unitCost !== undefined) {
      await setInventoryItemUnitCost(item.id, unitCost);
    }
    return NextResponse.json({ ...item, unitCost: unitCost ?? null }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
