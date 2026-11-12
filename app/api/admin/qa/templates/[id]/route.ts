import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { deleteQaTemplate, QaTemplateNotFoundError, recordQaRevision } from "@/lib/qa/template-admin";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  templateSchema: z.any().optional(),
});

function errorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : "";
  if (err instanceof QaTemplateNotFoundError) return 404;
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

/**
 * Edit a QA template (ADMIN). A change of name or schema is a new REVISION,
 * recorded in the audit log with the previous content (lib/qa/template-admin.ts);
 * switching it on or off is not. The `version` column is not changed: it
 * decides which active template of a scope inspections resolve to.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = patchSchema.parse(await req.json());
    const result = await db.$transaction(async (tx) => {
      const before = await tx.qaFormTemplate.findUnique({ where: { id: params.id } });
      if (!before) throw new QaTemplateNotFoundError();
      const contentChanged =
        (body.name !== undefined && body.name !== before.name) ||
        (body.templateSchema !== undefined && JSON.stringify(body.templateSchema) !== JSON.stringify(before.schema));
      const revision = contentChanged
        ? await recordQaRevision(tx, { template: before, actorId: session.user.id, nextName: body.name, nextSchema: body.templateSchema })
        : null;
      const updated = await tx.qaFormTemplate.update({
        where: { id: params.id },
        data: {
          name: body.name,
          isActive: body.isActive,
          schema: body.templateSchema === undefined ? undefined : (body.templateSchema as Prisma.InputJsonValue),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "QA_TEMPLATE_UPDATE",
          entity: "QaFormTemplate",
          entityId: updated.id,
          before: before as unknown as Prisma.InputJsonValue,
          after: updated as unknown as Prisma.InputJsonValue,
        },
      });
      return { updated, revision };
    });
    return NextResponse.json({ ...result.updated, revision: result.revision });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed" }, { status: errorStatus(err) });
  }
}

/**
 * Delete a QA template (ADMIN). One that any inspection used is deactivated
 * instead, so historical inspections never lose their template.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    return NextResponse.json(await deleteQaTemplate(params.id, session.user.id));
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed" }, { status: errorStatus(err) });
  }
}
