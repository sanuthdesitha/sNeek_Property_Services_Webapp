import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import {
  buildDefaultSelections,
  composeFormSchema,
  generatePropertyTemplates,
  mergeSelections,
  sanitizeSelections,
} from "@/lib/checklists/compose";
import { FEATURE_DEFS, sanitizeFeatures } from "@/lib/checklists/features";

const PROPERTY_RULE_FIELDS = {
  hasBalcony: true,
  bedrooms: true,
  bathrooms: true,
  laundryEnabled: true,
  inventoryEnabled: true,
  sofaBedCount: true,
  features: true,
} as const;

async function loadPropertyForRules(propertyId: string) {
  return db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, name: true, ...PROPERTY_RULE_FIELDS, checklistProfile: true },
  });
}

/**
 * GET — the resolved editor state: library, property features, effective
 * selections (saved merged over defaults), profile status, and a live preview
 * schema per job type (so the UI can render the cleaner-form preview).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await loadPropertyForRules(params.id);
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    let library = await getChecklistLibrary();
    if (library.length === 0) {
      await seedChecklistLibraryFromCatalog();
      library = await getChecklistLibrary();
    }

    const defaults = buildDefaultSelections(library, property);
    const saved = property.checklistProfile ? sanitizeSelections(property.checklistProfile.selections) : null;
    const selections = saved ? mergeSelections(defaults, saved) : defaults;

    const previewJobType = (req.nextUrl.searchParams.get("previewJobType") as JobType | null) ?? JobType.AIRBNB_TURNOVER;
    const preview = Object.values(JobType).includes(previewJobType)
      ? composeFormSchema(library, selections, previewJobType, property)
      : null;

    return NextResponse.json({
      propertyId: property.id,
      propertyName: property.name,
      features: sanitizeFeatures(property.features),
      featureDefs: FEATURE_DEFS,
      jobTypes: Object.values(JobType),
      library,
      selections,
      profile: property.checklistProfile
        ? {
            status: property.checklistProfile.status,
            approvedAt: property.checklistProfile.approvedAt,
            generatedTemplateIds: property.checklistProfile.generatedTemplateIds ?? {},
          }
        : null,
      preview,
      previewJobType,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const saveSchema = z.object({
  selections: z.any(),
  features: z.record(z.string(), z.boolean()).optional(),
});

/** PUT — save the draft selections (and optionally the property features). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = saveSchema.parse(await req.json());
    const property = await db.property.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    const selections = sanitizeSelections(body.selections);
    if (body.features) {
      await db.property.update({
        where: { id: params.id },
        data: { features: sanitizeFeatures(body.features) as any },
      });
    }
    const profile = await db.propertyChecklistProfile.upsert({
      where: { propertyId: params.id },
      create: { propertyId: params.id, selections: selections as any, status: "DRAFT" },
      // Editing after approval moves the profile back to DRAFT until re-approved
      // (the previously generated templates stay live for jobs meanwhile).
      update: { selections: selections as any, status: "DRAFT" },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PROPERTY_CHECKLIST_SAVE",
        entity: "Property",
        entityId: params.id,
        after: { status: profile.status } as any,
      },
    });
    return NextResponse.json({ ok: true, status: profile.status });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const approveSchema = z.object({
  jobTypes: z.array(z.nativeEnum(JobType)).min(1),
});

/** POST — approve: materialise FormTemplate(s) + register property overrides. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = approveSchema.parse(await req.json());
    const result = await generatePropertyTemplates({
      propertyId: params.id,
      jobTypes: body.jobTypes,
      actorUserId: session.user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
