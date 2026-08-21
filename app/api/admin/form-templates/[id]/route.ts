import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role, JobType } from "@prisma/client";
import { z } from "zod";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { formTemplateSchemaZ } from "@/lib/forms/template-schema";
import { isStaleTemplateWrite } from "@/lib/forms/template-concurrency";

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
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { expectedUpdatedAt, ...body } = updateTemplateSchema.parse(await req.json());

    // OPTIMISTIC CONCURRENCY. `schema` is replaced wholesale, so a save from a
    // stale editor silently destroys everything saved since that editor loaded.
    // That is not hypothetical: the builder seeds its state once from the RSC
    // payload, and a back-navigation re-mounts it from the PRE-EDIT payload, so
    // the owner sees their work missing, re-does an edit, saves — and the good
    // schema is gone from the database. Refusing the write is the only place
    // this can be stopped for certain, because it is the only place that knows
    // what is actually stored.
    if (expectedUpdatedAt) {
      const current = await db.formTemplate.findUnique({
        where: { id: params.id },
        select: { updatedAt: true },
      });
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (isStaleTemplateWrite(current.updatedAt, expectedUpdatedAt)) {
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
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await db.formTemplate.update({ where: { id: params.id }, data: body as any });
    return NextResponse.json(template);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
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
