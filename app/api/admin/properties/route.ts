import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPropertySchema, sanitizeSetupGuide } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import { applyDefaultStockToProperty, ensureDefaultInventoryItems } from "@/lib/inventory/default-items";
import { getApiErrorStatus } from "@/lib/api/http";
import { normalizeInventoryLocation } from "@/lib/inventory/locations";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { encryptSecret } from "@/lib/security/encryption";
import { getPropertyFormConfig } from "@/lib/property-form/config-store";
import { collectMissingRequired, pruneCustomValues } from "@/lib/property-form/config";

/**
 * Assemble the flat field-value map the property-form config evaluates its
 * required/conditional rules against — keyed by the same ids as the field
 * registry (system field id → value, pulling the couple that live in accessInfo).
 */
function buildSystemValues(body: Record<string, any>): Record<string, unknown> {
  const access = (body.accessInfo && typeof body.accessInfo === "object" ? body.accessInfo : {}) as Record<string, unknown>;
  return {
    clientId: body.clientId,
    name: body.name,
    address: body.address,
    suburb: body.suburb,
    state: body.state,
    postcode: body.postcode,
    linenBufferSets: body.linenBufferSets,
    bedrooms: body.bedrooms,
    bathrooms: body.bathrooms,
    defaultCleanDurationHours: access.defaultCleanDurationHours,
    maxGuestCount: access.maxGuestCount,
    defaultCheckinTime: body.defaultCheckinTime,
    defaultCheckoutTime: body.defaultCheckoutTime,
    hasBalcony: body.hasBalcony,
    inventoryEnabled: body.inventoryEnabled,
    laundryEnabled: body.laundryEnabled,
    lockbox: access.lockbox,
    codes: access.codes,
    parking: access.parking,
    other: access.other,
    instructions: access.instructions,
    laundryTeam: Array.isArray(access.laundryTeamUserIds) ? access.laundryTeamUserIds : [],
    cleaningDurationMinutes: body.cleaningDurationMinutes,
    assignedCleaningHours: body.assignedCleaningHours,
    cleanerServiceRate: body.cleanerServiceRate,
    sofaBedCount: body.sofaBedCount,
    laundryBagLabel: body.laundryBagLabel,
    laundryBagColor: body.laundryBagColor,
    setupGuide: body.setupGuide,
    notes: body.notes,
  };
}

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
    // One-off / service-site properties are hidden from the portfolio list by
    // default (they exist only to carry an ad-hoc address). Pass ?includeOneOff=1
    // to surface them.
    const includeOneOff = searchParams.get("includeOneOff") === "1";

    const properties = await db.property.findMany({
      where: {
        isActive: true,
        ...(clientId ? { clientId } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        integration: true,
        _count: { select: { jobs: true } },
      },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
    });

    // Hide genuine one-off / service-site properties from the portfolio list by
    // default. Filter in JS on the precise `accessInfo.serviceSite === true`
    // flag (set deliberately by ensureServiceSiteProperty) — a DB-level
    // `NOT { path: serviceSite = true }` wrongly drops EVERY property whose
    // accessInfo is null (SQL three-valued logic: NOT(unknown) = unknown), which
    // hid all real properties. Client-name is NOT used as a signal — real
    // recurring properties can legitimately sit under a catch-all client.
    const visible = includeOneOff
      ? properties
      : properties.filter((p) => (p.accessInfo as { serviceSite?: unknown } | null)?.serviceSite !== true);

    return NextResponse.json(visible);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createPropertySchema.parse(await req.json());

    const { defaultInventoryItemIds, customInventoryItems, customFields, ...propertyData } = body;

    // Enforce the admin-configured required/conditional rules + persist the
    // custom-field values (pruning any whose field is hidden / condition unmet).
    const formConfig = await getPropertyFormConfig();
    const systemValues = buildSystemValues(propertyData as Record<string, any>);
    const customValues = (customFields ?? {}) as Record<string, unknown>;
    const missing = collectMissingRequired(formConfig, systemValues, customValues);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Please complete the required field${missing.length > 1 ? "s" : ""}: ${missing.map((m) => m.label).join(", ")}.` },
        { status: 400 },
      );
    }
    const prunedCustomFields = pruneCustomValues(formConfig, systemValues, customValues);

    const normalizedAccessInfo = buildPropertyAccessInfo(propertyData as Record<string, any>);

    const property = await db.property.create({
      data: {
        ...propertyData,
        latitude: propertyData.latitude ?? undefined,
        longitude: propertyData.longitude ?? undefined,
        placeId: propertyData.placeId ?? undefined,
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
        customFields: Object.keys(prunedCustomFields).length > 0 ? (prunedCustomFields as any) : undefined,
        preferredCleanerUserId: propertyData.preferredCleanerUserId ?? undefined,
        setupGuide:
          propertyData.setupGuide !== undefined
            ? (sanitizeSetupGuide(propertyData.setupGuide) as any)
            : undefined,
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
