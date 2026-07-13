import { NextRequest, NextResponse } from "next/server";
import { JobType, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import { buildDefaultSelections, mergeSelections, sanitizeSelections } from "@/lib/checklists/compose";
import { FEATURE_DEFS, featuresFromAppliances, sanitizeFeatures } from "@/lib/checklists/features";
import { readAdminOverrides, readFormMeta } from "@/lib/onboarding/form-meta";

/**
 * Onboarding-survey flavour of the property checklist-profile endpoint. The
 * property doesn't exist yet, so the composer runs against a pseudo-property
 * built from the survey (bedrooms/bathrooms/balcony/laundry + appliance-derived
 * features). Selections + features are stored in adminOverrides.checklist and
 * materialised into a real profile + templates when the survey is approved.
 * Response shape mirrors /api/admin/properties/[id]/checklist-profile so the
 * same builder component drives both.
 */

async function loadSurvey(surveyId: string) {
  return db.propertyOnboardingSurvey.findUnique({
    where: { id: surveyId },
    include: { appliances: true, laundryDetail: true, jobTypeAnswers: true },
  });
}

function pseudoPropertyFromSurvey(
  survey: NonNullable<Awaited<ReturnType<typeof loadSurvey>>>,
  savedFeatures: Record<string, boolean> | null,
  scenarios: Record<string, unknown>
) {
  // Mirror the approval workflow: hasPets → petFriendly so the Checklist Preview
  // step reflects the pet-hair section that approval will materialise.
  const features =
    savedFeatures ?? {
      ...featuresFromAppliances(survey.appliances ?? []),
      ...(scenarios.hasPets === true ? { petFriendly: true } : {}),
    };
  return {
    hasBalcony: survey.hasBalcony,
    bedrooms: survey.bedrooms,
    bathrooms: survey.bathrooms,
    laundryEnabled: survey.laundryDetail?.hasLaundry ?? false,
    inventoryEnabled: false,
    features,
  };
}

function readChecklistOverride(adminOverrides: unknown): { selections?: unknown; features?: unknown } | null {
  const overrides = readAdminOverrides(adminOverrides);
  const checklist = overrides.checklist;
  return checklist && typeof checklist === "object" ? (checklist as { selections?: unknown; features?: unknown }) : null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const survey = await loadSurvey(params.id);
    if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });

    let library = await getChecklistLibrary();
    if (library.length === 0) {
      await seedChecklistLibraryFromCatalog();
      library = await getChecklistLibrary();
    }

    const meta = readFormMeta(survey.adminOverrides);
    const scenarios = (meta.scenarios ?? {}) as Record<string, unknown>;

    const checklistOverride = readChecklistOverride(survey.adminOverrides);
    const savedFeatures = checklistOverride?.features ? sanitizeFeatures(checklistOverride.features) : null;
    const pseudoProperty = pseudoPropertyFromSurvey(survey, savedFeatures, scenarios);

    const defaults = buildDefaultSelections(library, pseudoProperty);
    const saved = checklistOverride?.selections ? sanitizeSelections(checklistOverride.selections) : null;
    const selections = saved ? mergeSelections(defaults, saved) : defaults;

    // Job types the wizard selected (Cleaning Types step), for per-item chips.
    const metaJobTypes = Array.isArray(meta.selectedJobTypes) ? meta.selectedJobTypes : [];
    const answerJobTypes = survey.jobTypeAnswers.map((answer) => answer.jobType as string);
    const selectedJobTypes = (metaJobTypes.length ? metaJobTypes : answerJobTypes).filter((jobType) =>
      Object.values(JobType).includes(jobType as JobType)
    );

    return NextResponse.json({
      propertyId: survey.id,
      propertyName: survey.propertyName ?? survey.propertyAddress ?? "New property",
      features: pseudoProperty.features,
      featureDefs: FEATURE_DEFS,
      jobTypes: Object.values(JobType),
      selectedJobTypes,
      library,
      selections,
      profile: null,
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

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = saveSchema.parse(await req.json());
    const survey = await db.propertyOnboardingSurvey.findUnique({
      where: { id: params.id },
      select: { id: true, adminOverrides: true, status: true },
    });
    if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    if (survey.status === "APPROVED") {
      return NextResponse.json(
        { error: "Survey already approved — edit the checklist from the property's Forms tab instead." },
        { status: 409 }
      );
    }

    const overrides = readAdminOverrides(survey.adminOverrides);
    const nextOverrides = {
      ...overrides,
      checklist: {
        selections: sanitizeSelections(body.selections),
        ...(body.features ? { features: sanitizeFeatures(body.features) } : {}),
      },
    };
    await db.propertyOnboardingSurvey.update({
      where: { id: params.id },
      data: { adminOverrides: nextOverrides as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ ok: true, status: "DRAFT" });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
