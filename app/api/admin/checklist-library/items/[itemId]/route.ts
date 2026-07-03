import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const updateItemSchema = z.object({
  label: z.string().trim().min(1).max(240).optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
  imageUrl: z.string().trim().max(2000).nullable().optional(),
  videoUrl: z.string().trim().max(2000).nullable().optional(),
  fieldType: z.enum(["checkbox", "yesno", "photo", "video"]).optional(),
  required: z.boolean().optional(),
  minPhotos: z.number().int().min(0).max(20).nullable().optional(),
  stampTag: z.string().trim().max(40).nullable().optional(),
  defaultOn: z.boolean().optional(),
  jobTypes: z.array(z.nativeEnum(JobType)).optional(),
  appliesWhen: z
    .object({ feature: z.string().optional(), propertyField: z.string().optional(), equals: z.any().optional() })
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateItemSchema.parse(await req.json());
    const item = await db.checklistModuleItem.findUnique({ where: { id: params.itemId } });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

    const updated = await db.checklistModuleItem.update({
      where: { id: params.itemId },
      data: {
        label: body.label,
        instructions: body.instructions === undefined ? undefined : body.instructions,
        imageUrl: body.imageUrl === undefined ? undefined : body.imageUrl,
        videoUrl: body.videoUrl === undefined ? undefined : body.videoUrl,
        fieldType: body.fieldType,
        required: body.required,
        minPhotos: body.minPhotos === undefined ? undefined : body.minPhotos,
        stampTag: body.stampTag === undefined ? undefined : body.stampTag,
        defaultOn: body.defaultOn,
        jobTypes: body.jobTypes,
        appliesWhen: body.appliesWhen === undefined ? undefined : ((body.appliesWhen ?? null) as any),
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_ITEM_UPDATE",
        entity: "ChecklistModuleItem",
        entityId: item.id,
        before: { label: item.label, isActive: item.isActive } as any,
        after: { label: updated.label, isActive: updated.isActive } as any,
      },
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { itemId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const item = await db.checklistModuleItem.findUnique({
      where: { id: params.itemId },
      select: { id: true, key: true, label: true },
    });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    await db.checklistModuleItem.delete({ where: { id: params.itemId } });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_ITEM_DELETE",
        entity: "ChecklistModuleItem",
        entityId: item.id,
        before: { key: item.key, label: item.label } as any,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
