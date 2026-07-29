import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Prisma, Role } from "@prisma/client";
import { duplicateTemplateName, nextTemplateVersion } from "@/lib/forms/duplicate-template";

/**
 * Duplicate a FormTemplate — creates a new draft (isActive: false) with the
 * source template's schema copied, the next version number for that kind, and
 * `parentTemplateId` set to the source id so we can render the lineage tree
 * later.
 *
 * The copy is a DRAFT on purpose (publishing is an explicit, auditable step —
 * see the publish route, which retires the previous global default). Callers
 * must therefore ASK for drafts to see it: `GET /api/admin/form-templates`
 * hides them unless `includeDrafts=1` is passed. Not doing so is exactly why
 * "duplicate does nothing" was reported — the copy existed but no list showed
 * it.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const source = await db.formTemplate.findUnique({ where: { id: params.id } });
    if (!source) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Versions are allocated per kind; names are de-duplicated per kind too, so
    // repeated duplicates read as "(Copy)", "(Copy 2)", … instead of a pile of
    // identically named rows the owner cannot tell apart.
    const siblings = await db.formTemplate.findMany({
      where: { kind: source.kind },
      select: { name: true, version: true },
    });

    const copy = await db.formTemplate.create({
      data: {
        name: duplicateTemplateName(
          source.name,
          siblings.map((s) => s.name)
        ),
        kind: source.kind,
        serviceType: source.serviceType,
        version: nextTemplateVersion(siblings.map((s) => s.version)),
        schema: source.schema as Prisma.InputJsonValue,
        isActive: false,
        parentTemplateId: source.id,
      },
    });

    return NextResponse.json({ template: copy }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
