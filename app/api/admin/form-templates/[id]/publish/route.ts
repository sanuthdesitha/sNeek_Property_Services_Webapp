import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { z } from "zod";

const publishSchema = z.object({
  action: z.enum(["publish", "archive", "unarchive"]),
});

/**
 * Every template that is registered as SOME property's per-job-type override.
 * These are property-scoped (minted by generatePropertyTemplates) and must never
 * be auto-archived by a global publish, nor archived BY one — they coexist with
 * the global default by design (see app/api/jobs/[id]/form/route.ts).
 */
async function propertyScopedTemplateIds(): Promise<Set<string>> {
  const settings = await getAppSettings();
  const ids = new Set<string>();
  for (const perProperty of Object.values(settings.propertyFormTemplateOverrides ?? {})) {
    for (const templateId of Object.values(perProperty ?? {})) {
      if (typeof templateId === "string" && templateId) ids.add(templateId);
    }
  }
  return ids;
}

/**
 * Publish / archive / unarchive a FormTemplate.
 *
 *  - publish:   isActive=true, publishedAt=now, archivedAt=null. Also
 *               auto-archives the PRIOR active GLOBAL template of the same
 *               serviceType (mirroring generatePropertyTemplates, which retires
 *               its predecessor) — otherwise every publish leaves another
 *               selectable duplicate behind and the runtime "highest active
 *               version wins" fallback drifts. Property-scoped templates are
 *               skipped on both sides.
 *  - archive:   isActive=false, archivedAt=now
 *  - unarchive: archivedAt=null (does NOT republish — left as draft)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = publishSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    let data: Record<string, unknown>;
    if (parsed.data.action === "publish") {
      data = { isActive: true, publishedAt: new Date(), archivedAt: null };
    } else if (parsed.data.action === "archive") {
      data = { isActive: false, archivedAt: new Date() };
    } else {
      data = { archivedAt: null };
    }

    const template = await db.formTemplate.update({
      where: { id: params.id },
      data: data as any,
    });

    let archivedPrevious = 0;
    if (parsed.data.action === "publish") {
      const scoped = await propertyScopedTemplateIds();
      // Only a GLOBAL publish retires the previous global default.
      if (!scoped.has(template.id)) {
        const excluded = [template.id, ...Array.from(scoped)];
        const result = await db.formTemplate.updateMany({
          where: {
            serviceType: template.serviceType,
            isActive: true,
            id: { notIn: excluded },
          },
          data: { isActive: false, archivedAt: new Date() },
        });
        archivedPrevious = result.count;
      }
    }

    return NextResponse.json({ template, archivedPrevious });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
