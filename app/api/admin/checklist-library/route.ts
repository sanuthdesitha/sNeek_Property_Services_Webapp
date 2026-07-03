import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getChecklistLibrary, seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import { FEATURE_DEFS } from "@/lib/checklists/features";

/** GET — full library (modules + items) for the editor, plus feature defs. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    let modules = await getChecklistLibrary({ includeInactive: true });
    // First visit: auto-seed from the in-code catalog so the library isn't empty.
    if (modules.length === 0) {
      await seedChecklistLibraryFromCatalog();
      modules = await getChecklistLibrary({ includeInactive: true });
    }
    return NextResponse.json({
      modules,
      featureDefs: FEATURE_DEFS,
      jobTypes: Object.values(JobType),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const createModuleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, numbers and dashes only."),
  title: z.string().trim().min(1).max(120),
  category: z.enum(["ROOM", "APPLIANCE", "OUTDOOR", "SAFETY", "EXTRA"]).default("ROOM"),
  description: z.string().trim().max(2000).optional(),
  appliesWhen: z
    .object({ feature: z.string().optional(), propertyField: z.string().optional(), equals: z.any().optional() })
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional(),
});

/** POST — create a module. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createModuleSchema.parse(await req.json());
    const existing = await db.checklistModule.findUnique({ where: { key: body.key } });
    if (existing) {
      return NextResponse.json({ error: "A module with that key already exists." }, { status: 409 });
    }
    const maxOrder = await db.checklistModule.aggregate({ _max: { sortOrder: true } });
    const module = await db.checklistModule.create({
      data: {
        key: body.key,
        title: body.title,
        category: body.category,
        description: body.description || null,
        appliesWhen: (body.appliesWhen ?? null) as any,
        sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 10,
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHECKLIST_MODULE_CREATE",
        entity: "ChecklistModule",
        entityId: module.id,
        after: { key: module.key, title: module.title } as any,
      },
    });
    return NextResponse.json(module, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
