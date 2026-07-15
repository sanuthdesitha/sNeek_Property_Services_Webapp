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

/**
 * POST — live preview: compose the form schema for the given (unsaved)
 * selections + job type, using the SAME server-side composer that approval
 * uses, so the preview is exactly what the cleaner will get.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true, features: true, bedrooms: true, bathrooms: true, hasBalcony: true, inventoryEnabled: true, laundryEnabled: true, sofaBedCount: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    const body = previewSchema.parse(await req.json());
    const library = await getChecklistLibrary();
    const schema = composeFormSchema(library, sanitizeSelections(body.selections), body.jobType, property);
    return NextResponse.json({ schema, jobType: body.jobType });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
