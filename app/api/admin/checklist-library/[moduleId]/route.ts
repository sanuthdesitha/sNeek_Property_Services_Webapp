import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const updateModuleSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  category: z.enum(["ROOM", "APPLIANCE", "OUTDOOR", "SAFETY", "EXTRA"]).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  appliesWhen: z
    .object({ feature: z.string().optional(), propertyField: z.string().optional(), equals: z.any().optional() })
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateModuleSchema.parse(await req.json());
    const module = await db.checklistModule.findUnique({ where: { id: params.moduleId } });
    if (!module) return NextResponse.json({ error: "Module not found." }, { status: 404 });

    const updated = await db.checklistModule.update({
      where: { id: params.moduleId },
      data: {
        title: body.title,
        category: body.category,
        description: body.description === undefined ? undefined : body.description,
        appliesWhen: body.appliesWhen === undefined ? undefined : ((body.appliesWhen ?? null) as any),
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_MODULE_UPDATE",
        entity: "ChecklistModule",
        entityId: module.id,
        before: { title: module.title, isActive: module.isActive } as any,
        after: { title: updated.title, isActive: updated.isActive } as any,
      },
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const module = await db.checklistModule.findUnique({
      where: { id: params.moduleId },
      select: { id: true, key: true, title: true },
    });
    if (!module) return NextResponse.json({ error: "Module not found." }, { status: 404 });
    // Items cascade-delete with the module. Property profiles keep their
    // selections JSON (unknown keys are simply ignored on compose).
    await db.checklistModule.delete({ where: { id: params.moduleId } });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_MODULE_DELETE",
        entity: "ChecklistModule",
        entityId: module.id,
        before: { key: module.key, title: module.title } as any,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
