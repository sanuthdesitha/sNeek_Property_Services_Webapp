import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Prisma, Role } from "@prisma/client";

/**
 * Duplicate a FormTemplate — creates a new draft (isActive: false) with the
 * source template's schema copied, the next version number for that kind, and
 * `parentTemplateId` set to the source id so we can render the lineage tree
 * later.
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

    const last = await db.formTemplate.findFirst({
      where: { kind: source.kind },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;

    const copy = await db.formTemplate.create({
      data: {
        name: `${source.name} (Copy)`,
        kind: source.kind,
        serviceType: source.serviceType,
        version: nextVersion,
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
