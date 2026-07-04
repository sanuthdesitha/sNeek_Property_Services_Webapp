import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listVersions } from "@/lib/templates/store";

export const dynamic = "force-dynamic";

/** Version history for the drawer (newest first). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const definition = await db.templateDefinition.findUnique({
    where: { id: params.id },
    select: { id: true, publishedVersionId: true },
  });
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versions = await listVersions(definition.id);
  return NextResponse.json({
    publishedVersionId: definition.publishedVersionId,
    versions,
  });
}
