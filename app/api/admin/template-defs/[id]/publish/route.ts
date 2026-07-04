import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveBrandTokens } from "@/lib/brand/tokens";
import { getAppSettings } from "@/lib/settings";
import { lintTemplateDoc } from "@/lib/templates/lint";
import { safeParseTemplateDoc } from "@/lib/templates/model";
import { publishDraft } from "@/lib/templates/store";

export const dynamic = "force-dynamic";

const publishSchema = z.object({ draftId: z.string().min(1) });

/** Lint the draft against its kind contract; publish only when clean. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = publishSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "draftId required" }, { status: 400 });

  const draft = await db.templateVersion.findFirst({
    where: { id: parsed.data.draftId, definitionId: params.id, status: "DRAFT" },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const doc = safeParseTemplateDoc(draft.doc);
  if (!doc) return NextResponse.json({ error: "Stored draft is not a valid v2 doc" }, { status: 400 });

  const brand = resolveBrandTokens(await getAppSettings());
  const lint = lintTemplateDoc(doc, brand);
  if (!lint.ok) {
    return NextResponse.json({ published: false, ...lint }, { status: 422 });
  }

  const published = await publishDraft(params.id, draft.id, session.user.id);
  return NextResponse.json({
    published: true,
    versionId: published.id,
    version: published.version,
    warnings: lint.warnings,
  });
}
