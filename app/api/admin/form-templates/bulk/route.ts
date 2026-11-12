import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { runBulkTemplateOperation } from "@/lib/forms/template-bulk";
import { bulkRequestZ } from "@/lib/forms/template-bulk-types";
import { templateErrorResponse } from "@/lib/forms/template-errors";

/**
 * POST /api/admin/form-templates/bulk — one operation over up to
 * BULK_MAX_FORMS forms, with a per-form outcome.
 *
 *   { templateIds, operation, dryRun?, note? }
 *
 * Operations: edit-question, add-section, find-replace (saved as DRAFTS — the
 * live form is untouched until published), move-to-group, set-tags, publish,
 * duplicate, archive (same services and rules as the single-form routes).
 * `dryRun: true` returns the preview and changes nothing.
 *
 * ADMIN only, like every form-template write.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = bulkRequestZ.parse(await req.json());
    const result = await runBulkTemplateOperation({
      templateIds: body.templateIds,
      operation: body.operation,
      dryRun: body.dryRun,
      actorId: session.user.id,
      note: body.note,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return templateErrorResponse(err);
  }
}
