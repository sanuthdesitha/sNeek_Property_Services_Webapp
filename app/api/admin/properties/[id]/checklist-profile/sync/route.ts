import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { CATALOG_VERSION, getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import { buildDefaultSelections, mergeSelections, sanitizeSelections } from "@/lib/checklists/compose";

const PROPERTY_RULE_FIELDS = {
  hasBalcony: true,
  bedrooms: true,
  bathrooms: true,
  laundryEnabled: true,
  inventoryEnabled: true,
  sofaBedCount: true,
  features: true,
} as const;

/**
 * POST — MANUAL "update from standard" re-sync.
 *
 * Layers the current standard set (buildDefaultSelections) UNDER the property's
 * stored per-property toggles + custom items via mergeSelections. This ADDS any
 * newly-added standard items (enabled by default where the rules match) while
 * preserving every existing per-property override and custom item. Bumps
 * `syncedLibraryVersion` to CATALOG_VERSION and resets the profile to DRAFT so
 * the change is re-approved (previously generated templates stay live meanwhile).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, ...PROPERTY_RULE_FIELDS, checklistProfile: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    let library = await getChecklistLibrary();
    if (library.length === 0) {
      await seedChecklistLibraryFromCatalog();
      library = await getChecklistLibrary();
    }

    const defaults = buildDefaultSelections(library, property);
    const stored = property.checklistProfile
      ? sanitizeSelections(property.checklistProfile.selections)
      : { modules: {}, customItems: [] };
    const merged = mergeSelections(defaults, stored);

    // Diff: how many standard items are now available that weren't in the stored
    // selection map (i.e. newly added by a catalog bump).
    let newStandardItemCount = 0;
    for (const [moduleKey, moduleSel] of Object.entries(defaults.modules)) {
      const storedModule = stored.modules[moduleKey];
      for (const itemKey of Object.keys(moduleSel.items)) {
        if (!storedModule || !(itemKey in storedModule.items)) newStandardItemCount += 1;
      }
    }

    const profile = await db.propertyChecklistProfile.upsert({
      where: { propertyId: params.id },
      create: {
        propertyId: params.id,
        selections: merged as any,
        status: "DRAFT",
        syncedLibraryVersion: CATALOG_VERSION,
      },
      update: {
        selections: merged as any,
        status: "DRAFT",
        syncedLibraryVersion: CATALOG_VERSION,
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PROPERTY_CHECKLIST_SYNC",
        entity: "Property",
        entityId: params.id,
        after: { syncedLibraryVersion: CATALOG_VERSION, newStandardItemCount } as any,
      },
    });

    return NextResponse.json({
      ok: true,
      status: profile.status,
      selections: merged,
      syncedLibraryVersion: CATALOG_VERSION,
      newStandardItemCount,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
