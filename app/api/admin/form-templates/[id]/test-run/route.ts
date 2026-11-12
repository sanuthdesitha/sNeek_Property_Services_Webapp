import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { runFormTest } from "@/lib/forms/test-run";
import { TemplateServiceError, templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * "Test as cleaner": run the server's form validation (collectFormErrors) on
 * sample answers for the form being edited. READ ONLY by design — it creates
 * no submission, evidence, time log, notification or audit row, and touches
 * no job. ADMIN, like the builder.
 */
const bodySchema = z.object({
  schema: z.object({ sections: z.array(z.unknown()) }).passthrough(),
  answers: z.record(z.unknown()).default({}),
  uploadCounts: z.record(z.number().int().min(0).max(100)).default({}),
  property: z.record(z.unknown()).default({}),
  laundryReady: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN]);
    const body = bodySchema.parse(await req.json());
    const template = await db.formTemplate.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!template) throw new TemplateServiceError("NOT_FOUND", "Form template not found.");
    const settings = await getAppSettings();
    const result = runFormTest({
      schema: body.schema,
      answers: body.answers,
      uploadCounts: body.uploadCounts,
      property: body.property,
      laundryReady: body.laundryReady,
      requiredChecklistTicksBlockSubmit: settings.accountability?.requiredChecklistTicksBlockSubmit === true,
      // As a job started now would be judged.
      enforceExtended: settings.formValidation?.enforceExtended === true,
    });
    // `wouldHappen`: what the question effects would do; nothing is raised or reported here.
    return NextResponse.json({ problems: result.problems, blocking: result.blocking, warnings: result.warnings, wouldHappen: result.wouldHappen });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
