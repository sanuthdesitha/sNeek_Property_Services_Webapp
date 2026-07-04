import { NextRequest, NextResponse } from "next/server";
import { Role, TemplateVersionStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { getOrCreateDefinition } from "@/lib/templates/store";

export const dynamic = "force-dynamic";

/** List all template kinds with their definition/publish/draft state. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const definitions = await db.templateDefinition.findMany({
    where: { scope: "SYSTEM" },
    select: {
      id: true,
      kind: true,
      publishedVersionId: true,
      updatedAt: true,
      versions: {
        where: { status: TemplateVersionStatus.DRAFT },
        select: { id: true },
        take: 1,
      },
    },
  });
  const byKind = new Map(definitions.map((definition) => [definition.kind, definition]));

  const kinds = Object.values(TEMPLATE_KINDS).map((config) => {
    const definition = byKind.get(config.kind);
    return {
      kind: config.kind,
      label: config.label,
      family: config.family,
      definitionId: definition?.id ?? null,
      published: Boolean(definition?.publishedVersionId),
      hasDraft: (definition?.versions.length ?? 0) > 0,
    };
  });

  return NextResponse.json({ kinds });
}

const createSchema = z.object({ kind: z.string().min(1) });

/** Get-or-create the SYSTEM definition for a kind. */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "kind is required" }, { status: 400 });
  }
  if (!TEMPLATE_KINDS[parsed.data.kind]) {
    return NextResponse.json({ error: "Unknown template kind" }, { status: 400 });
  }

  const definition = await getOrCreateDefinition(parsed.data.kind);
  return NextResponse.json({ definitionId: definition.id });
}
