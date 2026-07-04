import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DraftConflictError, getOrCreateDraft, saveDraft } from "@/lib/templates/store";

export const dynamic = "force-dynamic";

/** GET the working draft (creating one from the published doc if needed). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const definition = await db.templateDefinition.findUnique({ where: { id: params.id } });
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const draft = await getOrCreateDraft(definition.id);
  return NextResponse.json({
    definitionId: definition.id,
    kind: definition.kind,
    draftId: draft.id,
    version: draft.version,
    doc: draft.doc,
    token: draft.updatedAt.toISOString(),
  });
}

const patchSchema = z.object({
  draftId: z.string().min(1),
  token: z.string().min(1),
  doc: z.unknown(),
});

/** PATCH the draft doc (autosave). Optimistic concurrency via token → 409. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const draft = await db.templateVersion.findFirst({
    where: { id: parsed.data.draftId, definitionId: params.id },
    select: { id: true },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  try {
    const { token } = await saveDraft(parsed.data.draftId, parsed.data.doc, parsed.data.token);
    return NextResponse.json({ token });
  } catch (err) {
    if (err instanceof DraftConflictError) {
      return NextResponse.json({ error: "Draft changed elsewhere — reload" }, { status: 409 });
    }
    // Zod doc validation failure lands here.
    return NextResponse.json({ error: "Invalid template document" }, { status: 400 });
  }
}
