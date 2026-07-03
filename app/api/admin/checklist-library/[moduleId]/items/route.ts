import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const createItemSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9.\-_]*$/, "Lowercase letters, numbers, dots and dashes only."),
  label: z.string().trim().min(1).max(240),
  instructions: z.string().trim().max(4000).optional(),
  imageUrl: z.string().trim().max(2000).optional(),
  videoUrl: z.string().trim().max(2000).optional(),
  fieldType: z.enum(["checkbox", "yesno", "photo", "video"]).default("checkbox"),
  required: z.boolean().default(false),
  minPhotos: z.number().int().min(0).max(20).nullable().optional(),
  stampTag: z.string().trim().max(40).nullable().optional(),
  defaultOn: z.boolean().default(true),
  jobTypes: z.array(z.nativeEnum(JobType)).default([]),
  appliesWhen: z
    .object({ feature: z.string().optional(), propertyField: z.string().optional(), equals: z.any().optional() })
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createItemSchema.parse(await req.json());
    const module = await db.checklistModule.findUnique({
      where: { id: params.moduleId },
      select: { id: true, key: true },
    });
    if (!module) return NextResponse.json({ error: "Module not found." }, { status: 404 });

    const existing = await db.checklistModuleItem.findUnique({
      where: { moduleId_key: { moduleId: module.id, key: body.key } },
    });
    if (existing) {
      return NextResponse.json({ error: "An item with that key already exists in this module." }, { status: 409 });
    }

    const maxOrder = await db.checklistModuleItem.aggregate({
      where: { moduleId: module.id },
      _max: { sortOrder: true },
    });
    const item = await db.checklistModuleItem.create({
      data: {
        moduleId: module.id,
        key: body.key,
        label: body.label,
        instructions: body.instructions || null,
        imageUrl: body.imageUrl || null,
        videoUrl: body.videoUrl || null,
        fieldType: body.fieldType,
        required: body.required,
        minPhotos: body.minPhotos ?? null,
        stampTag: body.stampTag || null,
        defaultOn: body.defaultOn,
        jobTypes: body.jobTypes,
        appliesWhen: (body.appliesWhen ?? null) as any,
        sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 10,
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_ITEM_CREATE",
        entity: "ChecklistModuleItem",
        entityId: item.id,
        after: { module: module.key, key: item.key, label: item.label } as any,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
