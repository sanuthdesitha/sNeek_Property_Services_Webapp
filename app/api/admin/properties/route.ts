import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPropertySchema } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import { applyDefaultStockToProperty, ensureDefaultInventoryItems } from "@/lib/inventory/default-items";
import { getApiErrorStatus } from "@/lib/api/http";
import { normalizeInventoryLocation } from "@/lib/inventory/locations";
import { getValidationErrorMessage } from "@/lib/validations/errors";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");

    const properties = await db.property.findMany({
      where: { isActive: true, ...(clientId ? { clientId } : {}) },
      include: {
        client: { select: { id: true, name: true } },
        integration: true,
        _count: { select: { jobs: true } },
      },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
    });

    return NextResponse.json(properties);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createPropertySchema.parse(await req.json());

    const { defaultInventoryItemIds, customInventoryItems, ...propertyData } = body;

    const property = await db.property.create({
      data: {
        ...propertyData,
        integration: { create: { isEnabled: false } },
      },
    });

    if (property.inventoryEnabled) {
      await ensureDefaultInventoryItems();

      const selectedItemIds = defaultInventoryItemIds ?? [];
      if (selectedItemIds.length > 0) {
        await applyDefaultStockToProperty(property.id, selectedItemIds);
      }

      if (customInventoryItems && customInventoryItems.length > 0) {
        for (const custom of customInventoryItems) {
          const item = await db.inventoryItem.create({
            data: {
              name: custom.name.trim(),
              category: custom.category.trim(),
              location: normalizeInventoryLocation(custom.location),
              unit: custom.unit.trim(),
              supplier: custom.supplier?.trim() || undefined,
              isActive: true,
            },
          });

          await db.propertyStock.upsert({
            where: {
              propertyId_itemId: {
                propertyId: property.id,
                itemId: item.id,
              },
            },
            create: {
              propertyId: property.id,
              itemId: item.id,
              onHand: custom.onHand,
              parLevel: custom.parLevel,
              reorderThreshold: custom.reorderThreshold,
            },
            update: {},
          });
        }
      }
    }

    return NextResponse.json(property, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create property.") }, { status });
  }
}
