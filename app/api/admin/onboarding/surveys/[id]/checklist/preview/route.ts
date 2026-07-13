import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getChecklistLibrary } from "@/lib/checklists/library";
import { composeFormSchema, sanitizeSelections } from "@/lib/checklists/compose";

const previewSchema = z.object({
  selections: z.any(),
  jobType: z.nativeEnum(JobType),
});

/** POST — live preview for the onboarding wizard's Checklist step. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const survey = await db.propertyOnboardingSurvey.findUnique({
      where: { id: params.id },
      select: { id: true, bedrooms: true, bathrooms: true, hasBalcony: true },
    });
    if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    const body = previewSchema.parse(await req.json());
    const library = await getChecklistLibrary();
    // Compose against a pseudo-property so per-room repetition matches the
    // template the property will get on approval.
    const pseudoProperty = {
      bedrooms: survey.bedrooms ?? 1,
      bathrooms: survey.bathrooms ?? 1,
      hasBalcony: survey.hasBalcony ?? false,
      inventoryEnabled: false,
      laundryEnabled: false,
    };
    const schema = composeFormSchema(library, sanitizeSelections(body.selections), body.jobType, pseudoProperty);
    return NextResponse.json({ schema, jobType: body.jobType });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
