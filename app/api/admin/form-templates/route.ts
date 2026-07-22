import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { z } from "zod";
import { Prisma, Role, JobType, FormKind } from "@prisma/client";

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  serviceType: z.nativeEnum(JobType),
  kind: z.nativeEnum(FormKind).optional(),
  schema: z.record(z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const url = new URL(req.url);
    const kindParam = url.searchParams.get("kind");
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const v1 = url.searchParams.get("v1") === "1";

    if (v1) {
      // V1 list view: include all (drafts, archived) and the kind/version fields.
      const templates = await db.formTemplate.findMany({
        where: kindParam ? { kind: kindParam as FormKind } : undefined,
        orderBy: [{ kind: "asc" }, { version: "desc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          serviceType: true,
          version: true,
          isActive: true,
          publishedAt: true,
          archivedAt: true,
          parentTemplateId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return NextResponse.json({ templates });
    }

    // Legacy list (backward-compat for existing /admin/forms page)
    const templates = await db.formTemplate.findMany({
      where: includeArchived ? undefined : { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    // Annotate each row with `propertyScoped` — true when the template is
    // registered as some property's per-job-type override (minted by
    // generatePropertyTemplates). Those must never be presented as the global
    // default; the runtime fallback explicitly excludes them.
    const settings = await getAppSettings();
    const scoped = new Set<string>();
    for (const perProperty of Object.values(settings.propertyFormTemplateOverrides ?? {})) {
      for (const templateId of Object.values(perProperty ?? {})) {
        if (typeof templateId === "string" && templateId) scoped.add(templateId);
      }
    }
    return NextResponse.json(
      templates.map((t) => ({ ...t, propertyScoped: scoped.has(t.id) }))
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createTemplateSchema.parse(await req.json());

    // For the V1 flow: if a `kind` is provided, find the next version number
    // for that kind and start the template as a DRAFT (isActive: false).
    if (body.kind) {
      const last = await db.formTemplate.findFirst({
        where: { kind: body.kind },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;
      const template = await db.formTemplate.create({
        data: {
          name: body.name,
          serviceType: body.serviceType,
          kind: body.kind,
          version: nextVersion,
          isActive: false,
          schema: (body.schema ?? { sections: [] }) as Prisma.InputJsonValue,
        },
      });
      return NextResponse.json(template, { status: 201 });
    }

    // Legacy create path
    const template = await db.formTemplate.create({
      data: {
        name: body.name,
        serviceType: body.serviceType,
        schema: (body.schema ?? {}) as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
