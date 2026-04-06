import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPropertySchema } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import { applyDefaultStockToProperty, ensureDefaultInventoryItems } from "@/lib/inventory/default-items";
import { getApiErrorStatus } from "@/lib/api/http";
import { normalizeInventoryLocation } from "@/lib/inventory/locations";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { encryptSecret } from "@/lib/security/encryption";

function buildPropertyAccessInfo(input: Record<string, any>) {
  const accessInfo =
    input.accessInfo && typeof input.accessInfo === "object" && !Array.isArray(input.accessInfo)
      ? { ...(input.accessInfo as Record<string, unknown>) }
      : {};

  const codeValue =
    typeof input.accessCode === "string" && input.accessCode.trim()
      ? input.accessCode.trim()
      : typeof accessInfo.codes === "string"
        ? String(accessInfo.codes).trim()
        : "";
  const keyLocation =
    typeof input.keyLocation === "string" && input.keyLocation.trim()
      ? input.keyLocation.trim()
      : typeof accessInfo.lockbox === "string"
        ? String(accessInfo.lockbox).trim()
        : "";
  const accessNotesParts = [
    typeof input.accessNotes === "string" ? input.accessNotes.trim() : "",
    typeof accessInfo.instructions === "string" ? String(accessInfo.instructions).trim() : "",
    typeof accessInfo.other === "string" ? String(accessInfo.other).trim() : "",
  ].filter(Boolean);

  return {
    ...accessInfo,
    lockbox: keyLocation,
    codes: codeValue,
    instructions:
      typeof accessInfo.instructions === "string" ? String(accessInfo.instructions).trim() : "",
    other: typeof accessInfo.other === "string" ? String(accessInfo.other).trim() : "",
    parking:
      typeof accessInfo.parking === "string" ? String(accessInfo.parking).trim() : "",
    laundryTeamUserIds: Array.isArray((accessInfo as any).laundryTeamUserIds)
      ? (accessInfo as any).laundryTeamUserIds
      : [],
    attachments: Array.isArray((accessInfo as any).attachments)
      ? (accessInfo as any).attachments
      : [],
    accessNotesSummary: accessNotesParts.join("\n\n"),
  };
}

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
    const normalizedAccessInfo = buildPropertyAccessInfo(propertyData as Record<string, any>);

    const property = await db.property.create({
      data: {
        ...propertyData,
        latitude: propertyData.latitude ?? undefined,
        longitude: propertyData.longitude ?? undefined,
        accessCode: encryptSecret(propertyData.accessCode ?? normalizedAccessInfo.codes ?? ""),
        alarmCode: encryptSecret(propertyData.alarmCode ?? ""),
        keyLocation:
          (typeof propertyData.keyLocation === "string" ? propertyData.keyLocation.trim() : "") ||
          normalizedAccessInfo.lockbox ||
          undefined,
        accessNotes:
          (typeof propertyData.accessNotes === "string" ? propertyData.accessNotes.trim() : "") ||
          normalizedAccessInfo.accessNotesSummary ||
          undefined,
        accessInfo: normalizedAccessInfo as any,
        preferredCleanerUserId: propertyData.preferredCleanerUserId ?? undefined,
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
