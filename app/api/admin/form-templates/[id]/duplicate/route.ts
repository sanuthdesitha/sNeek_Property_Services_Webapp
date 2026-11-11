import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { duplicateFormTemplate } from "@/lib/forms/duplicate-template-service";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * Duplicate a FormTemplate — creates a new draft (isActive: false) with the
 * source template's schema copied, the next version number for that kind, and
 * `parentTemplateId` set to the source id (lib/forms/duplicate-template-service).
 *
 * The copy is a DRAFT on purpose (publishing is an explicit, auditable step —
 * see the publish route, which retires the previous global default). Callers
 * must therefore ASK for drafts to see it: `GET /api/admin/form-templates`
 * hides them unless `includeDrafts=1` is passed. Not doing so is exactly why
 * "duplicate does nothing" was reported — the copy existed but no list showed
 * it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN]);
    // `{ from: "draft" }` (the builder): copy the unpublished draft when there is one.
    const body = (await req.json().catch(() => ({}))) as { from?: unknown };
    const copy = await duplicateFormTemplate(params.id, { fromDraft: body?.from === "draft" });
    return NextResponse.json({ template: copy }, { status: 201 });
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
