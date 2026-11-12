import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobType } from "@prisma/client";
import { z, ZodError } from "zod";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { formTemplateSchemaZ } from "@/lib/forms/template-schema";
import { isStaleTemplateWrite } from "@/lib/forms/template-concurrency";
import { readTemplateDraft, saveTemplateDraft } from "@/lib/forms/template-drafts";
import { TemplateServiceError, templateErrorResponse } from "@/lib/forms/template-errors";

const updateTemplateSchema = z.object({
  name: z.string().optional(),
  serviceType: z.nativeEnum(JobType).optional(),
  schema: formTemplateSchemaZ.optional(),
  isActive: z.boolean().optional(),
  /**
   * The `updatedAt` the editor loaded. Optional for older clients, but when
   * present it is enforced — see the PATCH below.
   */
  expectedUpdatedAt: z.string().datetime().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const template = await db.formTemplate.findUnique({ where: { id: params.id } });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(template);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}

/**
 * Legacy edit route. Content no longer reaches the live form from here:
 *
 *  - `schema` and `serviceType` (what a job resolves to and what a cleaner
 *    fills in) are saved to the template's DRAFT version through the same
 *    service as the builder (strict checks, 409 on a stale edit token).
 *    Publishing the draft is the only way they go live, as a new version.
 *  - `name` and `isActive` stay direct metadata edits of the row, as before,
 *    and are recorded in the audit log (FORM_TEMPLATE_METADATA).
 *
 * The response is the template row, plus `draftSaved` / `editToken` when a
 * draft was written, so an older caller that reads the row keeps working.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const { expectedUpdatedAt, schema, serviceType, name, isActive } = updateTemplateSchema.parse(await req.json());
    const current = await db.formTemplate.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, isActive: true, updatedAt: true },
    });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let draftToken: string | undefined;
    if (schema !== undefined || serviceType !== undefined) {
      const draft = await readTemplateDraft(params.id);
      const saved = await saveTemplateDraft({
        templateId: params.id,
        schema: schema ?? draft?.schema ?? (await db.formTemplate.findUniqueOrThrow({ where: { id: params.id }, select: { schema: true } })).schema,
        serviceType,
        name,
        actorId: session.user.id,
        expectedToken: expectedUpdatedAt,
      });
      draftToken = saved.token;
    } else if (expectedUpdatedAt && isStaleTemplateWrite(current.updatedAt, expectedUpdatedAt)) {
      return NextResponse.json(
        {
          error:
            "This template changed since you opened it. Reload to see the current version — saving now would overwrite that change.",
          code: "STALE_TEMPLATE",
          currentUpdatedAt: current.updatedAt.toISOString(),
        },
        { status: 409 }
      );
    }

    const metadata: { name?: string; isActive?: boolean } = {};
    if (name !== undefined && name !== current.name) metadata.name = name;
    if (isActive !== undefined && isActive !== current.isActive) metadata.isActive = isActive;
    const template = Object.keys(metadata).length
      ? await db.formTemplate.update({ where: { id: params.id }, data: metadata })
      : await db.formTemplate.findUniqueOrThrow({ where: { id: params.id } });
    if (Object.keys(metadata).length) {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "FORM_TEMPLATE_METADATA",
          entity: "FormTemplate",
          entityId: params.id,
          before: { name: current.name, isActive: current.isActive },
          after: metadata,
        },
      });
    }
    return NextResponse.json({
      ...template,
      ...(draftToken ? { draftSaved: true, editToken: draftToken } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof TemplateServiceError || err instanceof ZodError) return templateErrorResponse(err);
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security, "forms.delete");
    const existing = await db.formTemplate.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Soft delete = deactivate AND retire. `archivedAt` is what separates a
    // deliberately retired template from a work-in-progress draft; without it a
    // deleted template reappeared the moment any list started showing drafts
    // (see the `includeDrafts` branch in ../route.ts).
    const template = await db.formTemplate.update({
      where: { id: params.id },
      data: { isActive: false, archivedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DEACTIVATE_FORM_TEMPLATE",
        entity: "FormTemplate",
        entityId: params.id,
      },
    });
    return NextResponse.json({ ok: true, template });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
