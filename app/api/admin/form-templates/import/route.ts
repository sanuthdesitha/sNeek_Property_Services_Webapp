import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { importFormTemplates } from "@/lib/forms/template-transfer-server";
import { IMPORT_MAX_BYTES } from "@/lib/forms/template-transfer";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * POST /api/admin/form-templates/import?dryRun=1 — body: the exported file's
 * text. A dry run validates and previews; without it, every valid form is
 * created as a NEW draft (not live, never published, never overwriting an
 * existing form). ADMIN only, as form creation is. Body capped at
 * IMPORT_MAX_BYTES before parsing.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > IMPORT_MAX_BYTES) {
      return NextResponse.json({ error: `The file is larger than ${Math.round(IMPORT_MAX_BYTES / 1000)} KB.` }, { status: 413 });
    }
    const text = await req.text();
    if (text.length > IMPORT_MAX_BYTES) {
      return NextResponse.json({ error: `The file is larger than ${Math.round(IMPORT_MAX_BYTES / 1000)} KB.` }, { status: 413 });
    }
    const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
    return NextResponse.json(await importFormTemplates({ text, dryRun, actorId: session.user.id }));
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
