import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formTemplateSchemaZ } from "@/lib/forms/template-schema";
import { discardTemplateDraft, readTemplateDraft, saveTemplateDraft, templateEditToken } from "@/lib/forms/template-drafts";
import { TemplateServiceError, templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * The template's DRAFT version (its single working copy).
 *
 *   GET    → { draft | null, editToken }                 ADMIN, OPS_MANAGER
 *   PUT    { schema, name?, serviceType?, note?, expectedUpdatedAt? }
 *          → { draft, updatedAt, editToken }              ADMIN
 *   DELETE → { discarded }                                ADMIN
 *
 * Saving a draft never changes FormTemplate.schema, so what jobs resolve to
 * and what cleaners fill in stay exactly as published. `expectedUpdatedAt` is
 * the edit token the editor loaded; a stale one is refused with 409
 * STALE_TEMPLATE, as the builder's direct save always was.
 */
const saveDraftSchema = z.object({
  schema: formTemplateSchemaZ,
  name: z.string().trim().min(1).max(100).optional(),
  serviceType: z.nativeEnum(JobType).optional(),
  note: z.string().max(500).nullable().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const template = await db.formTemplate.findUnique({ where: { id: params.id }, select: { id: true, updatedAt: true } });
    if (!template) throw new TemplateServiceError("NOT_FOUND", "Not found");
    const draft = await readTemplateDraft(params.id);
    return NextResponse.json({ draft, editToken: templateEditToken(template.updatedAt, draft) });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = saveDraftSchema.parse(await req.json());
    const saved = await saveTemplateDraft({
      templateId: params.id,
      schema: body.schema,
      name: body.name,
      serviceType: body.serviceType,
      note: body.note,
      actorId: session.user.id,
      expectedToken: body.expectedUpdatedAt,
    });
    return NextResponse.json({
      draft: { id: saved.draft.id, baseVersion: saved.draft.baseVersion, updatedAt: saved.draft.updatedAt },
      updatedAt: saved.token,
      editToken: saved.token,
    });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json({ discarded: await discardTemplateDraft(params.id) });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
