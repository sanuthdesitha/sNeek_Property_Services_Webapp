import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import { buildDefaultSelections } from "@/lib/checklists/compose";

/**
 * Bulk checklist rollout for EXISTING properties.
 *   GET  — coverage table: every active property with its checklist status
 *          (NONE | DRAFT | APPROVED) so the admin can see what's left to do.
 *   POST — bulk "generate defaults": create DRAFT profiles (from the library +
 *          each property's attributes/features) for the selected properties
 *          that don't have one yet. The admin then reviews/approves each from
 *          the property's Forms tab.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const properties = await db.property.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        suburb: true,
        bedrooms: true,
        bathrooms: true,
        hasBalcony: true,
        features: true,
        client: { select: { name: true } },
        checklistProfile: { select: { status: true, approvedAt: true, updatedAt: true } },
      },
      orderBy: [{ name: "asc" }],
    });
    return NextResponse.json({
      properties: properties.map((property) => ({
        id: property.id,
        name: property.name,
        suburb: property.suburb,
        clientName: property.client?.name ?? "",
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        hasBalcony: property.hasBalcony,
        hasFeatures: Boolean(property.features && Object.keys(property.features as object).length > 0),
        checklistStatus: property.checklistProfile?.status ?? "NONE",
        approvedAt: property.checklistProfile?.approvedAt ?? null,
      })),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const bulkSchema = z.object({
  propertyIds: z.array(z.string().trim().min(1)).min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bulkSchema.parse(await req.json());

    let library = await getChecklistLibrary();
    if (library.length === 0) {
      await seedChecklistLibraryFromCatalog();
      library = await getChecklistLibrary();
    }

    const properties = await db.property.findMany({
      where: { id: { in: body.propertyIds } },
      select: {
        id: true,
        hasBalcony: true,
        bedrooms: true,
        bathrooms: true,
        laundryEnabled: true,
        inventoryEnabled: true,
        sofaBedCount: true,
        features: true,
        checklistProfile: { select: { id: true } },
      },
    });

    let created = 0;
    let skipped = 0;
    for (const property of properties) {
      // Never clobber an existing profile (draft OR approved) in bulk.
      if (property.checklistProfile) {
        skipped += 1;
        continue;
      }
      const defaults = buildDefaultSelections(library, property);
      await db.propertyChecklistProfile.create({
        data: {
          propertyId: property.id,
          selections: defaults as unknown as Prisma.InputJsonValue,
          status: "DRAFT",
        },
      });
      created += 1;
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_BULK_GENERATE_DEFAULTS",
        entity: "Property",
        entityId: "bulk",
        after: { requested: body.propertyIds.length, created, skipped } as any,
      },
    });
    return NextResponse.json({ ok: true, created, skipped });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
